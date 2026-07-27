#!/usr/bin/env node
/**
 * Bundle budget check.
 *
 * Measures what a first-time visitor actually downloads before the app is
 * interactive: the entry module plus every chunk Vite preloads for it. Lazily
 * imported chunks (CodeMirror language packs today; WebContainer, Pyodide, and
 * WebLLM later) are reported separately and are deliberately NOT counted
 * against the initial budget — keeping them out of that number is the point.
 *
 * Two thresholds, for two different jobs:
 *
 *   ceiling  a ratchet. Fails the build when the initial payload grows beyond
 *            the recorded baseline. This is what stops silent regressions.
 *   target   the engineering goal from the architecture plan. Reported on every
 *            run so the gap stays visible; does not fail the build on its own.
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs                 check against budget
 *   node scripts/check-bundle-budget.mjs --update-baseline  re-record the ceiling
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BUDGET_FILE = join(ROOT, 'bundle-budget.json');
const METRICS_FILE = join(ROOT, 'docs', 'baseline-metrics.json');

const DEFAULT_BUDGET = {
  /** Hard ceiling for initial gzipped JS, in bytes. Fails the build when exceeded. */
  initialJsGzipCeiling: null,
  /** Engineering goal from docs/SOURAI_COMPLETE_AGENT_PROMPT.md §24. */
  initialJsGzipTarget: 500 * 1024,
  /** Growth allowed above the recorded baseline before the check fails. */
  tolerancePercent: 2,
};

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function gzipSize(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

function readBudget() {
  if (!existsSync(BUDGET_FILE)) return { ...DEFAULT_BUDGET };
  try {
    return { ...DEFAULT_BUDGET, ...JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) };
  } catch (error) {
    fail(`bundle-budget.json is not valid JSON: ${error.message}`);
  }
}

/**
 * Collects the entry scripts and preloaded modules referenced by index.html.
 * Vite emits a `<link rel="modulepreload">` for every chunk in the entry's
 * static import graph, so this is the true initial JavaScript payload.
 */
function readInitialAssets(html) {
  const assets = new Set();
  const patterns = [
    /<script[^>]+type="module"[^>]+src="([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
    /<link[^>]+href="([^"]+)"[^>]+rel="modulepreload"/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      assets.add(match[1].replace(/^\//, ''));
    }
  }
  return [...assets];
}

function listJsFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...listJsFiles(full, rel));
    else if (entry.endsWith('.js')) out.push({ rel, full });
  }
  return out;
}

// ── Measure ─────────────────────────────────────────────────────────────────

if (!existsSync(DIST)) fail('dist/ does not exist. Run `npm run build` first.');

const indexHtml = join(DIST, 'index.html');
if (!existsSync(indexHtml)) fail('dist/index.html does not exist. Run `npm run build` first.');

const initialAssets = readInitialAssets(readFileSync(indexHtml, 'utf8'));
if (initialAssets.length === 0) {
  fail('No module scripts found in dist/index.html — the measurement would be meaningless.');
}

const allJs = listJsFiles(DIST);
const byRel = new Map(allJs.map((file) => [file.rel, file]));

const initial = [];
for (const asset of initialAssets) {
  if (!asset.endsWith('.js')) continue;
  const file = byRel.get(asset);
  if (!file) fail(`index.html references "${asset}", which is missing from dist/.`);
  initial.push({ rel: file.rel, gzip: gzipSize(file.full), raw: statSync(file.full).size });
}

const initialRelSet = new Set(initial.map((f) => f.rel));
const lazy = allJs
  .filter((file) => !initialRelSet.has(file.rel))
  .map((file) => ({ rel: file.rel, gzip: gzipSize(file.full), raw: statSync(file.full).size }));

const initialGzip = initial.reduce((sum, f) => sum + f.gzip, 0);
const initialRaw = initial.reduce((sum, f) => sum + f.raw, 0);
const lazyGzip = lazy.reduce((sum, f) => sum + f.gzip, 0);
const largest = [...initial].sort((a, b) => b.gzip - a.gzip)[0];

// ── Report ──────────────────────────────────────────────────────────────────

const budget = readBudget();
const target = budget.initialJsGzipTarget;

console.log('\n  Bundle budget');
console.log('  ─────────────────────────────────────────────');
console.log(`  initial JS   ${formatBytes(initialGzip)} gzip  (${formatBytes(initialRaw)} raw, ${initial.length} chunks)`);
console.log(`  lazy JS      ${formatBytes(lazyGzip)} gzip  (${lazy.length} chunks, not counted)`);
if (largest) console.log(`  largest      ${largest.rel} — ${formatBytes(largest.gzip)} gzip`);

const shouldUpdate = process.argv.includes('--update-baseline');
const ceiling =
  budget.initialJsGzipCeiling === null || shouldUpdate
    ? Math.ceil(initialGzip * (1 + budget.tolerancePercent / 100))
    : budget.initialJsGzipCeiling;

if (budget.initialJsGzipCeiling === null || shouldUpdate) {
  writeFileSync(
    BUDGET_FILE,
    `${JSON.stringify({ ...budget, initialJsGzipCeiling: ceiling }, null, 2)}\n`,
    'utf8'
  );
  console.log(`\n  Recorded a new ceiling of ${formatBytes(ceiling)} gzip in bundle-budget.json.`);
}

writeFileSync(
  METRICS_FILE,
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      initialJsGzipBytes: initialGzip,
      initialJsRawBytes: initialRaw,
      initialChunkCount: initial.length,
      lazyJsGzipBytes: lazyGzip,
      lazyChunkCount: lazy.length,
      largestInitialChunk: largest ? { file: largest.rel, gzipBytes: largest.gzip } : null,
      ceilingBytes: ceiling,
      targetBytes: target,
    },
    null,
    2
  )}\n`,
  'utf8'
);

const overTarget = initialGzip - target;
if (overTarget > 0) {
  console.log(
    `\n  ⚠ ${formatBytes(overTarget)} over the ${formatBytes(target)} target. ` +
      'Code-splitting is tracked as migration work — see docs/adr/0006-bundle-strategy.md.'
  );
} else {
  console.log(`\n  ✓ Within the ${formatBytes(target)} target.`);
}

if (initialGzip > ceiling) {
  fail(
    `Initial JS grew to ${formatBytes(initialGzip)} gzip, past the ${formatBytes(ceiling)} ceiling.\n` +
      '    Lazy-load the new dependency, or re-record the ceiling deliberately with:\n' +
      '    node scripts/check-bundle-budget.mjs --update-baseline'
  );
}

console.log(`  ✓ Within the ${formatBytes(ceiling)} regression ceiling.\n`);
