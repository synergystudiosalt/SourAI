import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end browser tests.
 *
 * The browser matrix is not cosmetic: the architecture depends on capabilities
 * that differ per engine (File System Access, OPFS, WebGPU, cross-origin
 * isolation). Each tier is exercised so the degraded experience is verified,
 * not assumed.
 *
 *   Chromium  full path — local folders, OPFS, runtimes
 *   Firefox   OPFS without File System Access
 *   WebKit    most reduced path
 *
 * Browsers are not installed automatically. Run once, locally and in CI:
 *   npx playwright install --with-deps
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // Network activity is the subject of the no-backend test, so every request
    // must be observable.
    serviceWorkers: 'block',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  // Tests run against a production build, because that is what the bundle
  // budget, the headers, and the code-splitting behaviour actually describe.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
