import { expect, test } from '@playwright/test';

import { buildSandboxedPreviewDocument } from '../src/security/previewIsolation';

test('sandboxed project previews cannot issue passive third-party requests', async ({
  context,
  page,
}) => {
  const canaryHost = 'preview-network-canary.invalid';
  const canaryRequests: string[] = [];
  await context.route(`https://${canaryHost}/**`, async (route) => {
    canaryRequests.push(route.request().url());
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  const source = [
    `<script>document.body.dataset.executed='yes';fetch('https://${canaryHost}/script-fetch')</script>`,
    `<style>body{background-image:url(https://${canaryHost}/css)}</style>`,
    `<img src="https://${canaryHost}/image">`,
    `<svg><image href="https://${canaryHost}/svg"></image></svg>`,
    `<video src="https://${canaryHost}/media"></video>`,
    `<meta content="0;url=https://${canaryHost}/refresh" http-equiv="refresh">`,
    `<me<meta charset=x>ta http-equiv="refresh" content="0;url=https://${canaryHost}/mutated-refresh">`,
    `<meta<meta charset=x> http-equiv="refresh" content="0;url=https://${canaryHost}/boundary-refresh">`,
    `İ<META http-equiv="refresh" content="0;url=https://${canaryHost}/unicode-index-refresh">`,
  ].join('');
  const srcDoc = buildSandboxedPreviewDocument(source);

  await page.evaluate((documentSource) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = documentSource;
    document.body.appendChild(frame);
  }, srcDoc);
  await page.waitForTimeout(300);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  expect(frame).toBeDefined();
  await expect
    .poll(async () => frame?.locator('body').getAttribute('data-executed'))
    .toBe('yes');

  expect(
    canaryRequests,
    `preview attempted passive requests:\n${canaryRequests.join('\n')}`
  ).toEqual([]);
});
