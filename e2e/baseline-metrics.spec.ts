import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface InteractionSample {
  homeUsableMs: number;
  navigationLoadMs: number;
  workspaceOpenMs: number;
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

test('records reproducible home and workspace interaction baselines', async ({
  browser,
}, testInfo) => {
  const samples: InteractionSample[] = [];

  // A new context per sample gives each run a fresh HTTP cache and local state.
  for (let sample = 0; sample < 3; sample++) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();

    const homeStartedAt = Date.now();
    await page.goto('http://localhost:4173/', { waitUntil: 'load' });
    await expect(page.getByPlaceholder('How can I help you today?')).toBeVisible();
    const homeUsableMs = Date.now() - homeStartedAt;
    const navigationLoadMs = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      return navigation?.loadEventEnd ?? 0;
    });

    const workspaceStartedAt = Date.now();
    await page.getByTitle('sour.ai IDE').click();
    await expect(page.getByText('Welcome back to sour.ai')).toBeVisible();
    const workspaceOpenMs = Date.now() - workspaceStartedAt;

    samples.push({
      homeUsableMs,
      navigationLoadMs: Math.round(navigationLoadMs),
      workspaceOpenMs,
    });
    await context.close();
  }

  for (const sample of samples) {
    expect(sample.homeUsableMs).toBeGreaterThan(0);
    expect(sample.navigationLoadMs).toBeGreaterThan(0);
    expect(sample.workspaceOpenMs).toBeGreaterThan(0);
  }

  const interaction = {
    measuredAt: new Date().toISOString(),
    methodology:
      'Median of 3 isolated Playwright browser contexts against a Vite production preview; each context starts with a fresh HTTP cache and local state.',
    project: testInfo.project.name,
    browserVersion: browser.version(),
    platform: process.platform,
    nodeVersion: process.version,
    sampleCount: samples.length,
    homeUsableMedianMs: median(samples.map((sample) => sample.homeUsableMs)),
    navigationLoadMedianMs: median(samples.map((sample) => sample.navigationLoadMs)),
    workspaceOpenMedianMs: median(samples.map((sample) => sample.workspaceOpenMs)),
    samples,
  };

  await testInfo.attach('interaction-baseline.json', {
    body: JSON.stringify(interaction, null, 2),
    contentType: 'application/json',
  });

  // Normal `npm run e2e` remains read-only. Only the deliberately named
  // recording command mutates the tracked baseline.
  if (process.env.npm_lifecycle_event === 'metrics:baseline') {
    const metricsPath = path.resolve(process.cwd(), 'docs', 'baseline-metrics.json');
    const current = JSON.parse(readFileSync(metricsPath, 'utf8'));
    writeFileSync(
      metricsPath,
      `${JSON.stringify({ ...current, interaction }, null, 2)}\n`,
      'utf8'
    );
  }
});
