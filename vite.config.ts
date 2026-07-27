import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {visualizer} from 'rollup-plugin-visualizer';

export default defineConfig(({mode}) => {
  const analyze = mode === 'analyze';

  return {
    plugins: [
      react(),
      tailwindcss(),
      // `npm run analyze` writes a treemap of the production bundle so the
      // cost of a new dependency is visible before it ships. Never enabled for
      // a normal build.
      ...(analyze
        ? [
            visualizer({
              filename: 'docs/bundle-report.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Surfaces the true download cost in build output; the enforced budget
      // lives in scripts/check-bundle-budget.mjs.
      reportCompressedSize: true,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
