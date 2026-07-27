import { expect, test } from '@playwright/test';

/**
 * The architecture gate: the finished application must make no request to a
 * SourAI-owned API.
 *
 * `loads without contacting a SourAI API` is enforceable today — a cold page
 * load already talks to nothing. The agent and chat assertions are marked
 * `fixme` because the current build still posts to the `/api/agent` and
 * `/api/chat` Pages Functions. Phase 3 replaces those with direct, BYOK
 * provider calls from a worker; the Phase 3 exit gate is these two tests
 * passing with the `fixme` markers removed.
 *
 * Deleting `functions/` before that happens is explicitly out of order: the
 * replacement has to reach parity first.
 */

const SOURAI_API = /\/api\//;

test('loads without contacting a SourAI API', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (SOURAI_API.test(new URL(request.url()).pathname)) apiRequests.push(request.url());
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();

  expect(apiRequests, `unexpected SourAI API requests:\n${apiRequests.join('\n')}`).toEqual([]);
});

test.fixme('sending a chat message makes no SourAI API request', async ({ page }) => {
  // Phase 3 exit gate. Today this posts to /api/chat.
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (SOURAI_API.test(new URL(request.url()).pathname)) apiRequests.push(request.url());
  });

  await page.goto('/');
  await page.getByPlaceholder('How can I help you today?').fill('hello');
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');

  expect(apiRequests).toEqual([]);
});

test.fixme('running the agent makes no SourAI API request', async ({ page }) => {
  // Phase 3 exit gate. Today this posts to /api/agent.
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (SOURAI_API.test(new URL(request.url()).pathname)) apiRequests.push(request.url());
  });

  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();
  await page.getByPlaceholder(/Ask|Plan|Edit/i).first().fill('list the files');
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');

  expect(apiRequests).toEqual([]);
});
