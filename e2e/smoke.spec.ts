import { expect, test } from '@playwright/test';

const APP_ORIGIN = 'http://localhost:4173';

/**
 * Critical-flow browser smoke tests against a production build.
 *
 * These run on Chromium, Firefox, and WebKit so the capability tiers described
 * in the architecture plan are verified rather than assumed.
 */

test('home screen loads and is usable', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const source = message.location().url;
      // The legacy shell has no favicon yet. Keep that known cosmetic 404 from
      // masking runtime errors while still failing on every other console error.
      if (source === `${APP_ORIGIN}/favicon.ico` && message.text().includes('404')) return;
      consoleErrors.push(source ? `${message.text()} (${source})` : message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByPlaceholder('How can I help you today?')).toBeVisible();
  await expect(page.getByText(/sour\.ai can make mistakes/i)).toBeVisible();
  expect(consoleErrors, `unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});

test('code workspace opens and offers its entry points', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();

  await expect(page.getByText('Welcome back to sour.ai')).toBeVisible();
  await expect(page.getByRole('button', { name: /New File/ })).toBeVisible();
});

test('a virtual project can be created entirely in the browser', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();

  await expect(page.getByText('untitled.txt').first()).toBeVisible();
});

test('local folder access reflects what the browser can actually do', async ({ page, browserName }) => {
  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();

  const openProject = page.getByRole('button', { name: /Open Project/ });
  await expect(openProject).toBeVisible();

  if (browserName === 'chromium') {
    // File System Access is available, so the control must be usable.
    await expect(openProject).toBeEnabled();
  } else {
    // Firefox and WebKit have no File System Access API. The control must be
    // disabled with an explanation, not fail after the user commits.
    await expect(openProject).toBeDisabled();
    await expect(openProject).toHaveAttribute('title', /Chromium-based browser/);
  }
});

test('the application shell loads no unexpected third-party resource or executable code', async ({ page }) => {
  const unexpectedRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN || url.protocol === 'data:' || url.protocol === 'blob:') return;
    unexpectedRequests.push(`${request.resourceType()} ${request.url()}`);
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The cold shell is self-contained: fonts, analytics, scripts, and every
  // other external resource must wait for an explicit user action.
  expect(
    unexpectedRequests,
    `unexpected third-party requests:\n${unexpectedRequests.join('\n')}`
  ).toEqual([]);
});
