import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Architecture gate: active chat and agent flows must make no request to a
 * SourAI-owned API. Legacy Pages Functions can remain for unrelated features,
 * but they are never an agent fallback.
 */

const APP_ORIGIN = 'http://localhost:4173';
const SOURAI_API = /^\/api(?:\/|$)/;
const REQUEST_OBSERVATION_MS = 300;

function isSourAiApiRequest(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  const isLegacySameOriginApi = url.origin === APP_ORIGIN && SOURAI_API.test(url.pathname);
  const isSourAiOwnedHost = /(^|\.)sour\.ai$/i.test(url.hostname);
  return isLegacySameOriginApi || isSourAiOwnedHost;
}

function monitorSourAiApiRequests(context: BrowserContext): string[] {
  const apiRequests: string[] = [];
  context.on('request', (request) => {
    if (isSourAiApiRequest(request.url())) apiRequests.push(request.url());
  });
  return apiRequests;
}

/**
 * `networkidle` only describes activity that has already started and returns
 * immediately when a page is idle. Keep observing after the UI reaches its
 * explicit completion state so debounced and worker-scheduled requests count.
 */
async function observeBoundedQuietPeriod(page: Page): Promise<void> {
  await page.waitForTimeout(REQUEST_OBSERVATION_MS);
}

test('SourAI API classifier rejects owned APIs without blocking provider paths', () => {
  expect(isSourAiApiRequest('http://localhost:4173/api/chat')).toBe(true);
  expect(isSourAiApiRequest('https://api.sour.ai/v1/agent')).toBe(true);
  expect(isSourAiApiRequest('https://gateway.eu.sour.ai/custom')).toBe(true);

  expect(isSourAiApiRequest('http://localhost:4173/assets/api/icon.svg')).toBe(false);
  expect(isSourAiApiRequest('https://provider.example/api/v1/chat')).toBe(false);
  expect(isSourAiApiRequest('https://not-sour.ai/api/chat')).toBe(false);
});

test('the monitor captures a SourAI API request scheduled after an idle page', async ({
  context,
  page,
}) => {
  const apiRequests = monitorSourAiApiRequests(context);
  await context.route('**/api/delayed-gate-probe', (route) => route.abort());

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    setTimeout(() => {
      void fetch('/api/delayed-gate-probe').catch(() => {});
    }, 50);
  });
  await observeBoundedQuietPeriod(page);

  expect(apiRequests).toContain(`${APP_ORIGIN}/api/delayed-gate-probe`);
});

test('loads without contacting a SourAI API', async ({ context, page }) => {
  const apiRequests = monitorSourAiApiRequests(context);

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();
  await expect(page.getByText('untitled.txt').first()).toBeVisible();
  await observeBoundedQuietPeriod(page);

  expect(apiRequests, `unexpected SourAI API requests:\n${apiRequests.join('\n')}`).toEqual([]);
});

test('sending a chat message makes no SourAI API request', async ({ context, page }) => {
  const apiRequests = monitorSourAiApiRequests(context);

  await page.goto('/');
  await page.getByPlaceholder('How can I help you today?').fill('hello');
  await page.keyboard.press('Enter');
  await expect(page.getByText('hello', { exact: true })).toBeVisible();
  await observeBoundedQuietPeriod(page);

  expect(apiRequests).toEqual([]);
});

test('running the agent makes no SourAI API request', async ({ context, page }) => {
  const apiRequests = monitorSourAiApiRequests(context);

  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();
  await expect(page.getByText('untitled.txt').first()).toBeVisible();
  // A provider must be chosen explicitly; there is no implicit default.
  await page.getByLabel('Model provider').selectOption('demo-echo');
  await page.getByPlaceholder(/Message agent/i).first().fill('list the files');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/this is not a language model/)).toBeVisible();
  await expect(page.getByText(/Your request: list the files/)).toBeVisible();
  await observeBoundedQuietPeriod(page);

  expect(apiRequests).toEqual([]);
});
