import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const systemChromeCandidates =
  process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
const useSystemChrome =
  process.env.PLAYWRIGHT_USE_SYSTEM_CHROME !== 'false' &&
  systemChromeCandidates.some((candidate) => existsSync(candidate));
const isRecordingBaseline = process.env.npm_lifecycle_event === 'metrics:baseline';

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
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Local contributors can run the critical Chromium gate without a
        // separate browser download when Chrome is already installed.
        ...(useSystemChrome ? { channel: 'chrome' as const } : {}),
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  // Tests run against a production build, because that is what the bundle
  // budget, the headers, and the code-splitting behaviour actually describe.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // A recorded baseline must describe this checkout's fresh production
    // build, never an unrelated dev/preview server already occupying the port.
    // strictPort then fails loudly instead of measuring stale assets.
    reuseExistingServer: !process.env.CI && !isRecordingBaseline,
    timeout: 180_000,
  },
});
