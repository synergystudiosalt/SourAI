import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vitest/config';

/**
 * Unit and integration test configuration.
 *
 * Kept separate from `vite.config.ts` so the Tailwind plugin and the dev-server
 * options never run during tests. Browser-level tests live in `e2e/` and are
 * driven by Playwright instead — see `playwright.config.ts`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist/**', 'e2e/**'],
    // Every test starts from a clean slate: no leaked spies, no leaked stubs.
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/vite-env.d.ts',
        'src/main.tsx',
      ],
    },
  },
});
