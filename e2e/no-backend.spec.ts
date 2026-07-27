import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

test.fixme('sending a chat message makes no SourAI API request', async ({ context, page }) => {
  // Phase 3 exit gate. Today this posts to /api/chat.
  const apiRequests = monitorSourAiApiRequests(context);

  await page.goto('/');
  await page.getByPlaceholder('How can I help you today?').fill('hello');
  await page.keyboard.press('Enter');
  await expect(page.getByText('hello', { exact: true })).toBeVisible();
  await observeBoundedQuietPeriod(page);

  expect(apiRequests).toEqual([]);
});

test.fixme('running the agent makes no SourAI API request', async ({ context, page }) => {
  // Phase 3 exit gate. Today this posts to /api/agent.
  const apiRequests = monitorSourAiApiRequests(context);

  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();
  await expect(page.getByText('untitled.txt').first()).toBeVisible();
  await page.getByPlaceholder(/Message Agent|Ask|Plan|Edit/i).first().fill('list the files');
  await page.keyboard.press('Enter');
  await expect(page.getByText('list the files', { exact: true })).toBeVisible();
  await observeBoundedQuietPeriod(page);

  expect(apiRequests).toEqual([]);
});
