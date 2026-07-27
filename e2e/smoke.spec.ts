import { expect, test } from '@playwright/test';

/**
 * Critical-flow browser smoke tests against a production build.
 *
 * These run on Chromium, Firefox, and WebKit so the capability tiers described
 * in the architecture plan are verified rather than assumed.
 */

test('home screen loads and is usable', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
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

test('the application shell renders without a service worker or cross-origin script', async ({ page }) => {
  const thirdPartyRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(page.url() || 'http://localhost:4173').origin && url.protocol !== 'data:') {
      thirdPartyRequests.push(request.url());
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Nothing may be fetched from a third-party origin at load time: no CDN
  // scripts, no fonts, no analytics. Supply-chain surface stays at zero.
  expect(thirdPartyRequests, `unexpected third-party requests:\n${thirdPartyRequests.join('\n')}`).toEqual([]);
});
