# 0006. Lazy runtimes and an enforced bundle ratchet

Status: Accepted
Date: 2026-07-27

## Context

Measured baseline, before any migration work:

```
dist/assets/index-*.js   2,342.79 kB raw   694.54 kB gzip   (single chunk)
```

Roughly 90 CodeMirror language packs already code-split correctly. The problem
is the entry chunk: React, Motion, `react-markdown` with `remark-math` and
`rehype-katex`, KaTeX, `pdfjs-dist`, `mammoth`, `jszip`, and the entire
application are in it — including PDF and DOCX parsers that only matter once a
user attaches a document.

The engineering target is under 500 kB gzip of initial JavaScript, excluding
lazily loaded editor language chunks. The baseline exceeds it by about 195 kB
before WebContainer, Pyodide, WebLLM, tree-sitter, or a Git implementation are
added — each of which is larger than the entire current bundle.

## Decision

**Nothing heavy loads at startup.** WebContainer, Pyodide, WebLLM, tree-sitter
grammars, `isomorphic-git`, PDF and DOCX parsing, and the diff engine are
dynamically imported at first use, behind their capability check.

**The budget is enforced by a build step, not by intention.**
`scripts/check-bundle-budget.mjs` reads `dist/index.html`, resolves the entry
script plus every `modulepreload`ed chunk — the true initial payload — and
gzips them. It reports two numbers:

- **ceiling**: a ratchet recorded in `bundle-budget.json`. Exceeding it fails
  the build. Raising it requires an explicit
  `--update-baseline` run, which shows up in review as a deliberate act.
- **target**: 500 kB gzip. Reported on every run so the remaining gap stays
  visible. It does not fail the build on its own, because failing every build
  from day one would just get the check disabled.

Lazy chunks are measured and reported separately, and are not counted against
the initial budget. Keeping them out of that number is the entire point.

`npm run analyze` produces a treemap at `docs/bundle-report.html` so the cost of
a dependency is visible before it ships.

## Consequences

- A regression is caught at build time by a specific number, not noticed months
  later.
- Adding a heavy dependency forces a decision: lazy-load it, or raise the
  ceiling in a reviewable commit. Both are fine; doing it silently is not.
- Cost: lazy loading adds real complexity — loading states, error states for a
  chunk that fails to fetch, and offline behaviour when a chunk was never
  cached. Each lazy boundary needs those handled.
- The ratchet starts above target. That is a deliberate, recorded debt, not an
  oversight: closing it means splitting the document parsers and the markdown
  and math stack out of the entry chunk, which is migration work rather than a
  Phase 0 change.

## Alternatives considered

**Fail the build at 500 kB immediately.** Rejected. Every build would fail from
the first commit, and the check would be switched off within a day. A ratchet
that holds is worth more than a target that is ignored.

**Track raw size instead of gzip.** Rejected. Users download compressed bytes;
raw size overstates the cost of repetitive code and would drive the wrong
optimisations.

**`manualChunks` splitting by vendor.** Insufficient on its own. Splitting a
vendor into a second chunk that is still preloaded moves bytes without removing
them from the initial payload. The fix is deferring the *import*, not renaming
the chunk.
