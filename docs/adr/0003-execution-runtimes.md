# 0003. In-browser execution runtimes and capability tiers

Status: Accepted
Date: 2026-07-27

## Context

A coding agent that cannot run anything cannot verify anything. Without
execution, "I fixed it" is a claim, not a result. But a browser tab cannot spawn
a process, and the runtimes that come closest each carry hard limits.

The current app has no execution at all: no terminal, no test runner, no
diagnostics, no dev server. Its verification step asks the model to re-read a
file and assert that it looks correct.

## Decision

Three runtimes, each behind a capability check and a lazily loaded adapter,
behind a common `ExecutionAdapter` interface.

**WebContainer** — Node.js and npm for JavaScript, TypeScript, and WASM
projects. At most one instance per page; parallel agents share a serialized
command queue. Requires cross-origin isolation (`COOP: same-origin` plus
`COEP: require-corp` or a tested `credentialless` configuration) and a
commercial licensing decision before general availability. Native Node addons do
not work unless a WASM build exists.

**Pyodide** — Python in a module worker. Pure-Python wheels and packages ported
to Pyodide only. Terminating the worker is the hard cancel path.

**Browser tasks** — work that needs no runtime at all: JSON and YAML parsing,
formatting, TypeScript language-service diagnostics, HTML and CSS analysis, diff
and static checks. This is the tier that still works when the other two are
unavailable, and it covers a meaningful share of verification.

Capability tiers, which the UI states rather than infers:

| Tier | Browser | What works |
|---|---|---|
| A | Chromium | Local folders, OPFS, WebContainer, Pyodide, WebGPU models |
| B | Firefox | OPFS projects, Pyodide, reduced runtime support |
| C | Safari / WebKit and older engines | Read, edit, chat, diff — no runtime |

Rules that hold across all three:

- A feature flag says a feature is *switched on*. A capability check says the
  browser *can do it*. Both are required; neither implies the other.
- A runtime is loaded on first use, never at startup.
- Every command has a working directory, a timeout, a maximum output size, and
  a process id. Output is streamed, bounded, and stored as an artefact once
  truncated.
- Credentials are never injected into a runtime environment.
- The application never evaluates model-produced strings via `eval`,
  `Function`, or in the page context.
- A terminal is labelled with the runtime it targets (`WebContainer`,
  `Pyodide`, `Browser`). It is not branded as a system shell, because it is not
  one.

Explicitly out of scope, and never simulated: arbitrary native binaries, Docker,
system services, kernel features, native Node addons without a WASM build, local
stdio MCP servers, ACP agents launched as local processes, and OS-level Git
worktrees. When one of these is required, the app says a desktop or remote
runtime would be needed.

## Consequences

- A supported JavaScript project can install, test, run, and preview entirely
  in the browser. That makes agent self-verification real for the most common
  case.
- An unsupported project fails with a precise capability error instead of a
  confusing runtime error. Detection quality is a product requirement.
- Cross-origin isolation constrains what can be embedded. Every third-party
  asset must satisfy CORP/COEP, which is a real cost and another reason to
  self-host assets.
- Tier C is a genuinely reduced product. It has to be pleasant, not a
  broken-looking version of Tier A.
- WebContainer licensing is a blocking commercial decision before Phase 5 ships.

## Alternatives considered

**A remote execution sandbox.** Rejected: it is a backend, and it would receive
the user's project.

**WASI in a bare WASM runtime instead of WebContainer.** Rejected for now.
Closer to the metal and unencumbered, but there is no npm ecosystem story, and
npm is what the target projects actually need.

**No execution; static analysis only.** Rejected. It is honest but leaves the
agent unable to verify its own work, which is the failure mode this rewrite
exists to fix.
