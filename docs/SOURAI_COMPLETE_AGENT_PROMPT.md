# SourAI Client-Side Business Agent Workspace

## Complete implementation prompt and reimplementation plan

Give this entire file to the coding agent.

### Master execution directive

You are the principal engineer responsible for reimplementing the agent system in the SourAI repository.

Your objective is to turn the current prototype into a professional, Zed-inspired, business-quality coding-agent workspace that runs entirely in the browser and is deployed as static assets on Cloudflare Pages.

This is an implementation assignment, not a request for another plan. The remainder of this file is the authoritative architecture, migration plan, security model, testing strategy, and Definition of Done. Read it completely before changing code, then implement it phase by phase.

#### Required initial inspection

Before editing:

1. Read this complete document.
2. Read any repository `AGENTS.md` or compatible instruction file.
3. Inspect the Git working tree and preserve unrelated user changes.
4. Inspect at least:
   - `package.json`
   - `vite.config.ts`
   - `.env.example`
   - `src/App.tsx`
   - `src/types.ts`
   - `src/components/CodeWorkspace.tsx`
   - `src/components/workspace/AgentPanel.tsx`
   - `src/utils/agentProtocol.ts`
   - `src/utils/realFs.ts`
   - `src/utils/workspaceFs.ts`
   - `functions/api/agent.ts`
   - `functions/api/chat.ts`
   - `functions/shared/ai.ts`
   - `functions/shared/systemPrompts.ts`
5. Run the existing TypeScript check and production build.
6. Record current critical behavior, bundle size, and known limitations.

Do not start with a visual redesign, a larger system prompt, or a mass rewrite.

#### Non-negotiable implementation rules

- The final application is client-only. Do not add or retain an active SourAI backend.
- Cloudflare Pages is used only for static hosting, headers, redirects, caching, and public build configuration.
- Treat every Vite-exposed environment variable as public.
- Never place provider keys, Git tokens, OAuth client secrets, signing keys, or encryption keys in client environment variables or built assets.
- Use session-local BYOK credentials by default and the encrypted local vault only after explicit consent.
- Run agent orchestration outside the React UI in a dedicated browser worker.
- Replace executable prose markers with versioned, schema-validated structured tool calls.
- Never ask for, store, or display hidden chain-of-thought.
- Make every mutation revision-checked, checkpointed, diffed, reviewable, and reversible.
- Make Ask and Plan profiles technically incapable of mutation.
- Detect unsupported browser capabilities and show an honest degraded experience.
- Preserve unrelated changes and never use destructive Git reset or checkout commands.
- Do not commit or push unless the user explicitly asks.
- Do not delete the legacy server path until the replacement has parity and an end-to-end network test proves no `/api/*` request is made.
- Keep large runtimes and language assets out of the initial bundle through lazy loading.

#### Phase working method

For each phase defined later in this document:

1. State the phase objective, affected modules, dependencies, and risks.
2. Implement the smallest coherent production-quality slice.
3. Add unit tests plus relevant integration, browser, failure-path, and security tests.
4. Run TypeScript, tests, the production build, and bundle checks.
5. Run the mandatory independent Codex CLI review workflow below.
6. Reproduce and fix confirmed findings, add regression coverage, and rerun affected checks.
7. Review the resulting diff for accidental scope expansion.
8. Report delivered behavior, verification results, reviewer findings, remaining limitations, and the next phase.
9. Do not mark the phase complete until its stated gate and review gate pass.

Use `npm.cmd` in Windows PowerShell if the local execution policy blocks `npm.ps1`.

When a requirement is impossible under the client-only constraint, do not bypass the constraint. Implement the safest honest fallback, keep the unsupported feature disabled, and document the browser limitation.

Completion means satisfying every item in the Definition of Done near the end of this file—not merely producing scaffolding or a successful build.

#### Mandatory Codex CLI delegation and independent review

Use the locally installed Codex CLI as a second engineering system throughout implementation. Do not wait until the end of the project.

Before the first delegated run:

1. Run `codex --version`.
2. Inspect `codex exec --help`.
3. Confirm the available sandbox, approval, output, model, and reasoning flags instead of guessing them.
4. Confirm that Codex authentication is available.
5. Run every command from the repository root.

If the CLI is missing, authentication is unavailable, or policy blocks it, report the exact blocker. Do not silently claim that a Codex review occurred.

##### Delegation policy

- The primary agent owns the plan, integration decisions, final edits, and verification.
- Delegate only concrete, bounded tasks with a clear input, scope, output format, and completion condition.
- Use Codex subagents for independent repository exploration, architecture checks, test-gap analysis, bug hunting, security review, accessibility review, performance review, and documentation verification.
- Ask Codex explicitly to spawn parallel subagents when the review areas are independent, wait for every subagent, and return one consolidated report.
- Keep review agents read-only. Use the supported read-only sandbox option reported by `codex exec --help`, and also state "Do not modify files" in the prompt.
- A read-only reviewer returns findings only: severity, confidence, file, line, evidence, user impact, and a minimal remediation.
- Do not let a reviewer fix its own findings before the primary agent has reproduced them.
- For a delegated implementation task, use a separate Git worktree or another isolated checkout. Never let the primary agent and a delegated CLI agent edit the same working tree concurrently.
- Assign non-overlapping file ownership to parallel implementation agents.
- Inspect and selectively integrate delegated changes. Never accept them blindly.
- Do not recursively launch uncontrolled Codex CLI trees. Only the primary implementation agent may start top-level `codex exec` jobs unless a prompt explicitly requests a bounded set of subagents.
- Keep concurrency conservative, normally three or fewer reviewers, to control cost and avoid resource contention.
- Never pass provider credentials, vault contents, private environment values, or user project secrets in a CLI prompt or captured output.

##### Required per-phase review

After implementation and local checks for every phase, run a read-only Codex CLI review of the uncommitted diff. The review prompt must ask Codex to create parallel subagents for:

1. **Correctness and regressions**
   - logic errors;
   - state-machine violations;
   - race conditions and stale closures;
   - cancellation/retry failures;
   - persistence and migration corruption;
   - filesystem conflicts and partial transactions;
   - browser compatibility.

2. **Security and privacy**
   - path traversal;
   - prompt/tool injection;
   - schema or policy bypass;
   - secret leakage;
   - unsafe Markdown/XSS;
   - preview isolation;
   - malicious imports;
   - outbound-data disclosure;
   - CSP and cross-origin isolation regressions.

3. **Tests, maintainability, and performance**
   - missing failure-path tests;
   - weak assertions or flaky tests;
   - unreachable/error states;
   - duplicated responsibilities;
   - oversized modules;
   - main-thread blocking;
   - eager-loading/bundle regressions;
   - accessibility regressions.

Use a prompt equivalent to:

```text
Review the current uncommitted changes for Phase <N> against
docs/SOURAI_COMPLETE_AGENT_PROMPT.md.

Work read-only and do not modify files. Spawn three parallel subagents:
1. correctness, regressions, races, state, storage, and browser compatibility;
2. security, privacy, permissions, secrets, injection, and filesystem safety;
3. missing tests, maintainability, performance, bundle size, and accessibility.

Each subagent must inspect the actual diff and relevant surrounding code, avoid
style-only comments, and report only actionable findings. For every finding,
include severity (P0-P3), confidence, file, line, evidence, impact, reproduction
or failing-test idea, and the smallest safe remediation. Wait for all three
subagents, deduplicate their results, and return one severity-ordered report.
If no actionable finding exists, say so explicitly and list what was checked.
```

Use the exact flags supported by the installed CLI. A typical shape, only after confirming it with `codex exec --help`, is:

```text
codex exec <read-only-sandbox-options> "<review prompt>"
```

Do not hard-code a model unless the user or repository configuration requires one. Let the installed Codex configuration choose a supported default.

##### Finding resolution gate

For every reported finding:

1. Inspect the cited code.
2. Reproduce it with a focused test, deterministic scenario, or concrete reasoning trace.
3. Classify it as confirmed, false positive, accepted limitation, or deferred.
4. Fix every confirmed P0/P1 finding before continuing.
5. Fix confirmed P2 findings in the same phase unless a documented dependency prevents it.
6. Add regression coverage for every bug that is fixed.
7. Record why false positives and accepted limitations are not changed.
8. Rerun typecheck, relevant tests, production build, and the targeted Codex review.

One reviewer saying "looks good" is not sufficient evidence. The primary agent remains responsible for verification.

##### Required specialized CLI passes

In addition to the per-phase review:

- After storage and filesystem phases, run a dedicated corruption, concurrency, traversal, and recovery review.
- After provider, credential, MCP, and preview phases, run a dedicated privacy, XSS, CORS/CSP, and secret-exfiltration review.
- After the parallel-agent phase, run a dedicated race, lease, cancellation, merge-conflict, and resource-exhaustion review.
- Before final release, run:
  - a whole-change correctness review against the baseline branch;
  - a security/privacy review;
  - a test-gap and flaky-test review;
  - an accessibility/performance/bundle review;
  - a documentation-versus-implementation consistency review.

The release is blocked while any confirmed P0/P1 issue, unexplained test failure, secret leak, destructive data-loss path, or client-only architecture violation remains.

Status: implementation blueprint  
Target: a professional, Zed-inspired coding-agent workspace delivered as a static Cloudflare Pages application  
Hard constraint: the application has no application backend, no Pages Functions, no Worker API, no remote workspace VM, and no server-side database  
Primary audience: the engineering agent that will reimplement the workspace and the humans reviewing its work

---

## 1. Executive decision

SourAI must be rebuilt as a client-authoritative application, not improved by adding more instructions to the current system prompt.

The finished product will be a static React PWA in which:

- the agent loop runs in a dedicated browser worker;
- project files live in the browser's Origin Private File System (OPFS), IndexedDB, a user-selected local directory, or a synchronized in-browser runtime;
- conversations, run events, approvals, checkpoints, usage, settings, profiles, and memory are persisted locally;
- model requests go directly from the browser to a user-selected provider using BYOK, or run locally with WebGPU;
- Node.js commands run in an in-browser WebContainer when supported;
- Python commands run in Pyodide when supported;
- Git operations run through isomorphic-git or the WebContainer runtime;
- model tool calls use validated structured schemas rather than text markers;
- every mutation is checkpointed, diffed, reviewable, reversible, and governed by local policy;
- Cloudflare Pages supplies static hosting, response headers, caching, and public build configuration only.

The finished application must not make requests to `/api/chat`, `/api/agent`, or any other SourAI-owned API. Explicit third-party calls to model providers, Git hosts, package registries, documentation sites, and remote MCP servers are allowed only when the user enables them and the browser permits them.

This design can reproduce most of the professional workflow of a desktop coding agent. It cannot honestly reproduce OS-level features that browsers do not expose. The product must display those boundaries instead of pretending they do not exist.

---

## 2. Cloudflare Pages boundary

Cloudflare Pages is the deployment platform, but not an application backend.

### Allowed

- Static HTML, JavaScript, CSS, WASM, worker scripts, model manifests, icons, and PWA assets.
- Cloudflare Pages build commands and static deployment.
- A `_headers` file for CSP, COOP, COEP, and other response headers.
- A `_redirects` file for SPA routing.
- Pages build-time environment variables for public configuration.
- CDN caching of immutable application assets.
- Browser requests made directly to explicitly configured third-party services.

### Forbidden in the target architecture

- `functions/` endpoints used by the running app.
- Cloudflare Workers used as model proxies or secret stores.
- Durable Objects, D1, R2, KV, Queues, or Workflows used as application state.
- Server-side authentication, billing enforcement, organization policy, audit storage, or remote command execution.
- Any SourAI-owned API that receives project code, prompts, conversations, keys, or tool results.

### Environment-variable rule

Vite only exposes client variables through `import.meta.env` when they are statically included, normally using a `VITE_` prefix. Those values become readable in the browser bundle. They are public configuration, not secrets.

Use Pages variables for values such as:

- `VITE_APP_ENV`
- `VITE_RELEASE_SHA`
- `VITE_DEFAULT_PROVIDER`
- `VITE_DEFAULT_MODEL`
- `VITE_ENABLE_WEBLLM`
- `VITE_ENABLE_WEBCONTAINERS`
- `VITE_ENABLE_PYODIDE`
- `VITE_PUBLIC_GITHUB_CLIENT_ID` if a fully client-safe PKCE flow is supported
- `VITE_ALLOWED_PROVIDER_ORIGINS`
- `VITE_ALLOWED_MCP_ORIGINS`
- `VITE_SENTRY_DSN` only if client telemetry is enabled and the DSN is intended to be public

Never put these in a client-visible environment variable:

- model-provider API keys;
- OAuth client secrets;
- private Git tokens;
- signing private keys;
- encryption master keys;
- paid WebContainer credentials unless the vendor explicitly documents the credential as origin-bound and safe to ship to browsers.

The default credential experience is BYOK with session-only storage. Optional persistent storage uses a local encrypted vault described later in this plan.

---

## 3. Current repository audit

### What exists and should be preserved where useful

- React 19, TypeScript, and Vite form a workable static-client foundation.
- CodeMirror already provides the editor.
- The workspace can create a virtual project and open a real local folder through the File System Access API.
- File explorer, tabs, preview, attachment handling, chat rendering, model selection, dark mode, and visual components provide useful product scaffolding.
- The current build and TypeScript check pass.
- The current agent UI already exposes plan/write modes, file operations, tool indicators, todos, context, and streaming.

### What must be replaced

`functions/api/agent.ts`

- Runs the present agent request through a server endpoint.
- Builds one large prompt containing file context.
- uses string-based prompt instructions for tools.
- exposes generated "thinking" text and asks the model to emit reasoning tags.
- has no durable client-side run state, replay, local policy engine, or schema-validated tools.

`functions/shared/systemPrompts.ts`

- Defines a text protocol such as `@@readfile`, `@@replace`, file fences, and XML tags.
- couples orchestration behavior to the prompt instead of typed runtime contracts.
- encourages visible reasoning text, which is not required for a professional activity log.

`src/utils/agentProtocol.ts`

- parses model prose with regular expressions;
- permits malformed or ambiguous tool requests;
- cannot provide strong argument validation, idempotency, or versioning;
- mixes display text with machine instructions.

`src/components/workspace/AgentPanel.tsx`

- is roughly 1,800 lines and owns UI, storage, prompt construction, network calls, tool execution, mutation, memory, todo management, streaming, and orchestration;
- is difficult to test and creates race-condition risk;
- stores thread and context state in ad hoc `localStorage` keys;
- performs client mutations without a formal transaction/checkpoint layer.

`src/App.tsx` and `src/components/CodeWorkspace.tsx`

- keep important domain state directly in React component state;
- use `localStorage` as canonical persistence;
- have no versioned schema, migrations, quota recovery, cross-tab locking, or crash recovery.

`src/utils/realFs.ts`

- is a useful browser adapter, but it needs project trust, permission recovery, atomic-write behavior, conflict detection, and a consistent interface shared with OPFS and WebContainer storage.

### Missing capabilities

- schema-based native tool calling;
- provider capability negotiation;
- client-side model option;
- event-sourced runs and crash recovery;
- real approvals and permission rules;
- protected edit transactions and checkpoints;
- terminal and process management;
- diagnostics and test execution;
- Git status, diff, branch, commit, and change review;
- indexed context and symbol retrieval;
- skills and hierarchical instructions;
- remote HTTP MCP support;
- parallel threads with isolation and conflict resolution;
- local encrypted credential vault;
- local audit trail and export;
- explicit privacy, network, and cost controls;
- automated agent evaluations;
- modular tests around the runtime.

### Baseline performance concern

The current production JavaScript bundle is approximately 2.34 MB before gzip. Large language packs and future WASM runtimes must be loaded lazily. WebContainer, Pyodide, local models, PDF processing, and language services must never be part of the initial application chunk.

---

## 4. Product definition

### Product promise

SourAI is a privacy-first, local-by-default web coding workspace in which a user can open or create a project, select a local or BYOK model, ask an agent to work, review every action, run supported code in the browser, inspect changes, and undo safely without sending project state to a SourAI backend.

### Primary workflows

1. Open a local folder or create/import a browser project.
2. Start one or more agent threads scoped to that project.
3. Add explicit context through mentions, selections, files, diagnostics, Git diff, or skills.
4. Choose an agent profile and model.
5. Let the agent read/search, propose a plan, edit, run supported commands, and verify.
6. Approve or deny sensitive actions according to local policy.
7. Review a unified diff, accept or discard individual hunks, and restore checkpoints.
8. Preview a running web application and surface runtime errors back to the agent.
9. Commit, export, or apply the result to the user's real folder.
10. Resume the thread later from local persistence.

### Professional feature set

- Thread sidebar with running, waiting, completed, failed, cancelled, archived, and restored states.
- Agent profiles: Ask, Plan, Write, Autonomous, and custom.
- Model/provider selection with capability and privacy indicators.
- Structured tool cards with status, inputs, outputs, duration, and approval state.
- Plan/todo panel with live progress.
- Explicit context chips and a context-budget inspector.
- File explorer, tabs, editor, terminal, problems panel, source-control panel, preview, and review pane.
- Checkpoints and one-click restore.
- Inline assistant for a selection.
- Edit prediction as a separately controlled feature.
- Git commit-message generation from a local diff.
- Instructions, skills, memory, and remote HTTP MCP integrations.
- Import/export of settings, profiles, threads, audit events, and encrypted project bundles.
- Keyboard-first command palette and accessible UI.

---

## 5. Honest browser capability matrix

The implementation must use this matrix in product copy and test planning.

| Capability | Client-only support | Required behavior |
|---|---:|---|
| Read, search, create, edit, move, and delete project files | Full | OPFS/virtual projects across modern browsers; local folders where File System Access is supported |
| Durable local threads and settings | Full | IndexedDB metadata plus OPFS blobs |
| Streaming model responses | Full when provider supports browser CORS | Abortable fetch and provider-specific stream parsers |
| Local LLM inference | Conditional | WebLLM/WebGPU capability check, model download consent, storage estimate, worker isolation |
| Node.js terminal and dev servers | Conditional/full for supported JS/WASM projects | WebContainer; lazy boot; one shared runtime; clear compatibility errors |
| Python execution | Conditional | Pyodide worker; only supported/pure-Python or ported packages |
| Arbitrary native binaries, Docker, system services, kernel features | Not supported | Never claim support; explain that a desktop/remote runtime would be required |
| Native Node addons | Generally not supported | Detect and explain; offer WASM/JS alternatives |
| Git core workflows | Strong but not identical to native Git | isomorphic-git and/or WebContainer Git; document LFS, signing, hooks, and submodule limitations |
| True OS Git worktrees | Not supported | Simulate isolated snapshots/branches in OPFS and merge through reviewed diffs |
| Local stdio MCP servers | Not supported | Support remote Streamable HTTP MCP only |
| ACP agents launched as local processes | Not supported | Do not include in client-only scope |
| Parallel agent reasoning | Supported within browser resources | Dedicated workers; concurrency budgets; shared runtime queue |
| Parallel independent Node runtimes | Not supported by a single page with WebContainer | Use one WebContainer and serialize runtime-mutating work |
| Work continuing after the browser is closed | Not reliable | Persist event state and resume on reopen; never promise background completion |
| Hidden application secrets | Not possible | BYOK/session vault; explain that build variables are public |
| Central SSO, SCIM, server-enforced RBAC, tamper-proof organization policy | Not possible without a backend | Provide local profiles/policy import/export only; do not label them server-enforced |
| Tamper-proof enterprise audit retention | Not possible | Provide append-only local audit records and signed/exportable bundles, with an explicit local-trust label |

---

## 6. Target client architecture

### 6.1 Runtime layers

```text
Cloudflare Pages static assets
        |
        v
React application shell
  |-- editor / explorer / diff / terminal / preview
  |-- thread sidebar / agent panel / approvals / settings
  |
  +--> application services
        |-- project service
        |-- thread service
        |-- change transaction service
        |-- provider registry
        |-- policy service
        |-- capability service
        |
        +--> agent orchestrator worker
        |     |-- run state machine
        |     |-- structured tool dispatcher
        |     |-- context assembler
        |     |-- provider adapters
        |     |-- budget/cancellation controller
        |     +-- event emitter
        |
        +--> storage worker
        |     |-- IndexedDB metadata
        |     |-- OPFS files, blobs, indexes, checkpoints
        |     +-- migrations, locking, quota management
        |
        +--> runtime adapters
              |-- WebContainer adapter (Node.js/WASM)
              |-- Pyodide adapter (Python/WASM)
              |-- browser-native adapter
              |-- local-folder adapter
              +-- Git adapter
```

### 6.2 Threading model

The main thread owns only React rendering, user gestures, browser permission prompts, and APIs that require a window context.

Use dedicated workers for:

- agent orchestration;
- indexing and search;
- local model inference;
- Pyodide;
- storage operations that can use OPFS synchronous access handles;
- large file parsing;
- diff computation if profiling shows main-thread stalls.

Use a typed `MessageChannel` RPC layer. Every request includes:

- protocol version;
- request ID;
- project ID;
- thread ID when applicable;
- abort token;
- deadline;
- input schema version.

Every reply includes:

- request ID;
- success/error discriminant;
- typed result or normalized error;
- duration;
- optional retryability.

No worker may mutate React state directly. The UI consumes domain events through a single store.

### 6.3 Client service boundaries

`ProjectService`

- creates/imports/opens/closes projects;
- owns the selected filesystem adapter;
- handles trust status and permission recovery;
- coordinates snapshots and real-folder synchronization.

`ThreadService`

- creates, restores, archives, forks, exports, and deletes threads;
- exposes an ordered event stream;
- enforces one active mutation run per project unless isolation exists.

`AgentRunService`

- starts, steers, pauses, resumes, cancels, and retries runs;
- owns budgets and run state;
- never executes tools directly.

`ToolService`

- registers tool descriptors;
- validates arguments and results;
- consults policy;
- creates approvals;
- dispatches to an adapter;
- records the complete lifecycle.

`ChangeService`

- creates pre-change checkpoints;
- applies patches using expected content hashes;
- calculates diffs;
- detects conflicts;
- accepts/rejects hunks;
- restores checkpoints.

`ContextService`

- resolves explicit mentions and selections;
- searches lexical/symbol indexes;
- loads instructions and skills;
- computes a context budget;
- deduplicates by content hash;
- produces provenance metadata for every context item.

`CredentialVault`

- keeps provider tokens in memory by default;
- optionally stores encrypted ciphertext locally;
- never exposes tokens to project code, prompts, logs, audit exports, or preview frames.

`CapabilityService`

- detects File System Access, OPFS, Web Workers, service workers, WebGPU, cross-origin isolation, WebContainer compatibility, storage quota, and browser limitations;
- turns unsupported features off instead of failing late.

---

## 7. Target source layout

Keep one Vite application, but replace feature logic with explicit modules:

```text
src/
  app/
    AppShell.tsx
    routes.tsx
    providers.tsx
  components/
    ui/
    editor/
    workspace/
    agent/
    review/
    terminal/
    git/
    settings/
  features/
    projects/
    threads/
    approvals/
    checkpoints/
    profiles/
    skills/
    instructions/
    memory/
    mcp/
    usage/
    audit/
  agent/
    core/
      orchestrator.ts
      runStateMachine.ts
      budgets.ts
      cancellation.ts
      compaction.ts
    context/
      contextAssembler.ts
      contextBudget.ts
      provenance.ts
      repoMap.ts
    providers/
      types.ts
      registry.ts
      openAICompatible.ts
      gemini.ts
      webllm.ts
      customEndpoint.ts
    policy/
      policyEngine.ts
      ruleMatcher.ts
      riskClassifier.ts
    tools/
      registry.ts
      contracts.ts
      readFile.ts
      listDirectory.ts
      glob.ts
      searchText.ts
      fileInfo.ts
      applyPatch.ts
      writeFile.ts
      deletePath.ts
      movePath.ts
      diagnostics.ts
      terminal.ts
      git.ts
      fetchUrl.ts
      memory.ts
      todo.ts
      checkpoint.ts
      preview.ts
  runtime/
    filesystem/
      types.ts
      opfsAdapter.ts
      indexedDbAdapter.ts
      localFolderAdapter.ts
      webContainerFsAdapter.ts
      syncEngine.ts
    execution/
      types.ts
      webContainerAdapter.ts
      pyodideAdapter.ts
      browserTaskAdapter.ts
      processManager.ts
    git/
      gitAdapter.ts
      isomorphicGitAdapter.ts
    mcp/
      client.ts
      transport.ts
  storage/
    database.ts
    schema.ts
    migrations/
    repositories/
    blobStore.ts
    quota.ts
    locks.ts
  security/
    credentialVault.ts
    crypto.ts
    redaction.ts
    pathSafety.ts
    contentSecurity.ts
    projectTrust.ts
  workers/
    agent.worker.ts
    storage.worker.ts
    indexer.worker.ts
    pyodide.worker.ts
    localModel.worker.ts
  state/
    workspaceStore.ts
    selectors.ts
  contracts/
    events.ts
    commands.ts
    errors.ts
  test/
    fixtures/
    fakes/
```

The current 1,800-line `AgentPanel.tsx` becomes a view layer composed from small components and hooks. It must not contain provider fetches, file mutation algorithms, local database code, or the agent loop.

---

## 8. Local persistence model

### 8.1 Storage choices

Use IndexedDB for transactional metadata and OPFS for large or frequently modified byte content.

IndexedDB stores:

- settings and feature flags;
- projects and filesystem descriptors;
- serializable file handles where supported;
- threads, messages, runs, events, tool calls, and approvals;
- profiles, policies, skills, instructions, MCP configurations;
- usage entries and audit entries;
- checkpoint manifests and artifact metadata;
- schema version and migration state;
- cross-tab leases.

OPFS stores:

- virtual project files;
- content-addressed file blobs;
- checkpoint data;
- imported attachments;
- search indexes;
- downloaded local model artifacts when the model library does not own its cache;
- encrypted export staging files.

`localStorage` may contain only tiny non-authoritative preferences required before database startup, such as theme and last-opened route. It must not be canonical storage for threads, projects, messages, memory, quotas, or credentials.

### 8.2 Database stores

Use a versioned schema with at least these stores:

| Store | Primary key | Important indexes |
|---|---|---|
| `settings` | `key` | scope |
| `projects` | `id` | lastOpenedAt, adapterType, archivedAt |
| `projectHandles` | `projectId` | permissionState |
| `threads` | `id` | projectId+updatedAt, status, archivedAt |
| `messages` | `id` | threadId+sequence |
| `runs` | `id` | threadId+createdAt, projectId+status |
| `events` | `id` | runId+sequence, threadId+globalSequence, type |
| `toolCalls` | `id` | runId+sequence, status, toolName |
| `approvals` | `id` | runId+status, expiresAt |
| `checkpoints` | `id` | projectId+createdAt, runId |
| `artifacts` | `id` | projectId, threadId, contentHash |
| `memories` | `id` | projectId+kind, contentHash |
| `profiles` | `id` | name, builtIn |
| `skills` | `id` | scope+name, enabled |
| `instructions` | `id` | projectId+priority |
| `mcpServers` | `id` | enabled, origin |
| `providerConfigs` | `id` | providerType, enabled |
| `usageEvents` | `id` | providerId+createdAt, runId |
| `auditEvents` | `id` | projectId+sequence, category |
| `indexManifests` | `projectId` | version, updatedAt |
| `leases` | `resourceKey` | ownerTabId, expiresAt |
| `migrations` | `version` | completedAt |

Every persisted object has a schema version. Migrations are:

- forward-only;
- idempotent;
- resumable after interruption;
- tested against fixtures from every released schema;
- backed up before destructive transformation.

### 8.3 Event durability

The run event log is the source of truth. UI state is derived from events.

Before rendering an irreversible state transition, persist it. Token deltas may be batched for performance, but final assistant content and tool lifecycle transitions must be durable.

Each event includes:

```ts
interface AgentEventV1 {
  id: string;
  version: 1;
  projectId: string;
  threadId: string;
  runId: string;
  sequence: number;
  type: AgentEventType;
  createdAt: number;
  causationId?: string;
  correlationId: string;
  payload: unknown;
}
```

Sequence numbers are monotonic within a run. Duplicate event IDs are ignored. Replaying an event stream must reconstruct the same visible run state.

### 8.4 Quota and recovery

- Request persistent storage with `navigator.storage.persist()` after explaining why.
- Show quota estimate and application usage.
- Warn before downloads or imports likely to exceed storage.
- Provide cleanup by category: model cache, runtime cache, checkpoints, attachments, archived threads, indexes.
- Never automatically delete the only copy of project content.
- Export an encrypted recovery bundle before destructive database repair.
- Detect private/incognito mode and warn that persistence may be temporary.

---

## 9. Filesystem architecture

### 9.1 Common interface

All project storage implements a single typed interface:

```ts
interface WorkspaceFileSystem {
  capabilities(): FileSystemCapabilities;
  stat(path: WorkspacePath): Promise<FileStat>;
  readFile(path: WorkspacePath, options?: ReadOptions): Promise<FileReadResult>;
  readDirectory(path: WorkspacePath): Promise<DirectoryEntry[]>;
  writeFile(path: WorkspacePath, data: Uint8Array, precondition: WritePrecondition): Promise<FileVersion>;
  createDirectory(path: WorkspacePath): Promise<void>;
  deletePath(path: WorkspacePath, precondition: DeletePrecondition): Promise<void>;
  movePath(from: WorkspacePath, to: WorkspacePath, precondition: MovePrecondition): Promise<void>;
  snapshot(paths?: WorkspacePath[]): Promise<SnapshotManifest>;
  watch?(listener: FileChangeListener): Unsubscribe;
}
```

Paths are normalized, relative, forward-slash paths. Reject:

- absolute paths;
- `..` traversal;
- NUL bytes;
- invalid Unicode normalization;
- reserved internal namespaces;
- writes outside the selected project root.

### 9.2 OPFS projects

OPFS is the canonical option for browser-native projects and isolated thread snapshots.

- Use content hashing to deduplicate checkpoints.
- Store manifest updates atomically.
- Keep a write-ahead journal for multi-file transactions.
- Run heavy OPFS work in a storage worker.
- Implement import/export as streaming ZIP where possible.

### 9.3 Real local folders

The File System Access adapter:

- requests permission only from a direct user gesture;
- rechecks permission after reload;
- never assumes retained permission;
- records file metadata and hashes to detect external changes;
- writes a temporary sibling then replaces when the API permits a safe pattern;
- requires approval for delete, bulk write, and rename;
- creates a checkpoint in OPFS before changing real files;
- offers "review in virtual snapshot, then apply" as the default;
- refuses to overwrite content whose expected hash no longer matches.

The agent never receives raw `FileSystemHandle` objects.

### 9.4 Synchronization

The editor, OPFS snapshot, local folder, and WebContainer filesystem must not independently become sources of truth.

Use a `WorkspaceSyncEngine` with:

- one canonical project revision;
- per-file content hashes;
- ordered change transactions;
- origin tags (`editor`, `agent`, `local-external`, `runtime`, `git`);
- loop prevention;
- three-way conflict detection;
- explicit resolution UI.

Every mutation produces a new revision. A run records the revision it read. Writes use optimistic concurrency and fail with a typed conflict when the revision changed.

---

## 10. Model and provider architecture

### 10.1 Provider modes

Support three modes:

1. `local`
   - WebLLM in a worker using WebGPU.
   - No prompt or project content leaves the browser.
   - Model artifacts are downloaded with explicit consent.

2. `byok`
   - Direct browser requests to supported providers.
   - The provider must allow browser CORS and streaming.
   - Credentials are supplied by the user.

3. `custom`
   - Direct calls to an OpenAI-compatible or explicitly supported endpoint.
   - The user sees the endpoint origin and data-sharing warning.
   - The endpoint must support CORS.

Do not ship shared SourAI model keys.

### 10.2 Provider contract

```ts
interface ModelProvider {
  id: string;
  getModels(signal: AbortSignal): Promise<ModelDescriptor[]>;
  validateConfiguration(signal: AbortSignal): Promise<ProviderValidation>;
  createResponse(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
  estimateTokens?(input: ModelInput): Promise<TokenEstimate>;
}
```

`ModelDescriptor` declares:

- context window;
- output limit;
- streaming;
- structured tool calling;
- JSON schema quality;
- image input;
- reasoning controls;
- prompt caching;
- cost metadata;
- local/remote privacy classification.

The UI prevents a tool profile from being selected with a model that cannot support its required tool contract. A constrained JSON compatibility adapter may be used for weak providers, but its output is still parsed and validated as a standalone envelope; it must never restore the old `@@tool` prose protocol.

### 10.3 Credential vault

Default: credentials live only in memory for the current tab/session.

Optional "Remember on this device":

- derive a key from a user passphrase using a reviewed KDF;
- generate a random data-encryption key;
- encrypt each credential with AES-GCM using a unique nonce and authenticated metadata;
- store only ciphertext, salt, KDF parameters, and wrapped key material;
- keep the unlocked key only in memory;
- auto-lock after inactivity, visibility timeout, or explicit lock;
- redact secrets from errors, logs, exports, prompts, and runtime environments.

The UI must state that local encryption does not protect against malicious JavaScript executing in the same origin. Therefore:

- enforce a strict CSP;
- avoid runtime third-party scripts;
- pin dependencies and assets;
- use Trusted Types where practical;
- keep preview content on an isolated origin supplied by the runtime;
- never render untrusted HTML in the application origin.

### 10.4 Context sent to providers

Before each remote request, show a privacy summary that can be expanded:

- provider and endpoint origin;
- files/chunks included;
- attachments included;
- instructions/skills included;
- memory included;
- estimated tokens;
- secret-redaction status.

Offer a "never send" path rule list. Apply redaction before tokenization and persist only the redacted request trace unless the user enables full local debugging.

### 10.5 Local models

Use WebLLM behind a lazy-loaded adapter.

- Detect WebGPU before offering it.
- Show model size, expected memory, and storage.
- Provide download/pause/resume/delete controls where supported.
- Run inference in a worker.
- Limit context and concurrency based on measured device capability.
- Do not make a local model the default until it passes the same tool-conformance evaluation as remote models.
- Fall back gracefully when WebGPU is unavailable or lost.

---

## 11. Agent runtime

### 11.1 Run state machine

Valid states:

```text
created
  -> preparing
  -> running_model
  -> evaluating_tool
  -> waiting_for_approval
  -> running_tool
  -> waiting_for_user
  -> compacting
  -> running_model
  -> verifying
  -> completed

Any active state -> cancelling -> cancelled
Any active state -> failed
failed -> retrying -> last safe resumable state
```

Transitions are explicit, validated, and evented. No component may set a run to an arbitrary string.

### 11.2 Loop algorithm

1. Acquire a project run lease.
2. Persist `run.created`.
3. Capture the project revision and create a checkpoint for mutating profiles.
4. Load the profile, instructions, selected skills, policies, provider, and model capabilities.
5. Assemble context with provenance and token budgets.
6. Persist a redacted request summary.
7. Stream the provider response through an `AbortController`.
8. If the provider returns assistant text, persist/render it.
9. If the provider returns tool calls:
   - validate the tool name;
   - validate arguments against the versioned schema;
   - normalize paths and URLs;
   - classify risk;
   - consult profile availability and permission rules;
   - auto-deny, request approval, or execute;
   - persist every transition;
   - validate and bound the tool result;
   - append the result to the next model turn.
10. If context crosses a threshold, compact into a factual run summary with provenance.
11. Continue until completion, budget exhaustion, user input, cancellation, or a typed failure.
12. For mutating work, run configured verification.
13. Present final summary, changed files, tests, warnings, usage, and checkpoint.
14. Release leases in `finally`.

### 11.3 Budgets

Every run has configurable limits:

- wall-clock time;
- model turns;
- tool calls;
- mutation count;
- total bytes read;
- total bytes written;
- terminal processes;
- command duration;
- remote requests;
- input/output tokens;
- estimated monetary cost;
- local model memory;
- context compactions.

Defaults must be conservative. On budget exhaustion, pause and ask rather than silently extending.

### 11.4 Cancellation and steering

- All provider fetches use `AbortSignal`.
- All tools accept cancellation where the underlying API supports it.
- Process manager can terminate a WebContainer process.
- Long searches and indexes yield progress and check cancellation.
- User steering is queued at a safe boundary and appended as a new user event.
- Cancel must not roll back already accepted changes automatically; it must offer checkpoint restore.

### 11.5 Reasoning privacy

Do not ask models to emit private chain-of-thought or artificial `<think>` tags.

The UI displays:

- short model-provided or application-generated activity labels;
- plans and todos;
- tool inputs and outputs;
- concise decision summaries;
- verification results;
- errors and recovery actions.

It does not require, store, or expose hidden reasoning.

---

## 12. Structured tool system

### 12.1 Tool descriptor

```ts
interface ToolDefinition<TInput, TOutput> {
  name: string;
  version: number;
  title: string;
  description: string;
  risk: ToolRisk;
  capabilities: ToolCapability[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  summarizeInput(input: TInput): ToolSummary;
  execute(context: ToolExecutionContext, input: TInput): Promise<TOutput>;
}
```

Tool results have hard byte limits and structured truncation metadata. Large results become local artifacts referenced by ID.

### 12.2 Required built-in tools

Read/search:

- `project_list`
- `directory_list`
- `file_stat`
- `file_read`
- `file_read_range`
- `glob`
- `text_search`
- `symbol_search`
- `references_search`
- `diagnostics_get`
- `git_status`
- `git_diff`

Mutation:

- `directory_create`
- `file_write`
- `file_apply_patch`
- `file_delete`
- `path_move`
- `edit_batch`
- `checkpoint_create`
- `checkpoint_restore`

Execution:

- `terminal_exec`
- `terminal_start`
- `terminal_write`
- `terminal_stop`
- `test_run`
- `task_run`
- `preview_start`
- `preview_stop`
- `preview_errors`

Knowledge:

- `url_fetch`
- `memory_get`
- `memory_put`
- `memory_delete`
- `todo_update`
- `skill_load`

Git:

- `git_log`
- `git_show`
- `git_branch_list`
- `git_branch_create`
- `git_checkout`
- `git_stage`
- `git_unstage`
- `git_commit`

Remote integrations:

- namespaced MCP tools using `mcp:<serverId>:<toolName>`.

### 12.3 Edit contract

Prefer patches over full-file replacement.

Every edit includes:

- project revision;
- path;
- expected content hash or explicit create-only precondition;
- patch or full new content;
- reason summary;
- tool call ID.

Apply multi-file edits as a transaction:

1. validate every path and precondition;
2. create or reuse a checkpoint;
3. stage changes in OPFS;
4. calculate resulting hashes and diffs;
5. commit the manifest atomically;
6. synchronize to runtime/local folder if configured;
7. emit one transaction result.

If one file conflicts, do not partially apply unless the user explicitly chooses partial application.

### 12.4 Terminal policy

Commands are not native OS commands. They target a named browser runtime.

Default rules:

- Node/WebContainer commands require confirmation until the user establishes an allow rule.
- Package installation always displays package names and registry origins.
- Commands with destructive-looking arguments, recursive deletion, credential access, or network behavior always confirm.
- Commands have a working directory, timeout, maximum output, and process ID.
- Output is streamed, bounded, and stored as an artifact after truncation.
- Secrets are not added to the runtime environment by default.
- The application never executes a model-produced string with `eval`, `Function`, or in the page context.

---

## 13. Policy, profiles, and approvals

### 13.1 Profiles

Built-in profiles:

`Ask`

- read/search/context tools only;
- no mutation, Git mutation, terminal, or external MCP mutation.

`Plan`

- Ask tools plus diagnostics and read-only Git;
- may create a proposed plan and proposed edits, but does not apply them.

`Write`

- file mutation enabled;
- each edit transaction checkpointed;
- safe project writes can be auto-approved if the user enables that rule;
- terminal and network remain separately governed.

`Autonomous`

- all supported tools available;
- still respects deny rules, secret boundaries, budgets, and high-risk confirmations;
- must not be the first-run default.

Custom profiles select:

- provider/model default;
- available built-in tools;
- available MCP tools;
- budget defaults;
- verification commands;
- memory behavior;
- context sources;
- approval policy.

### 13.2 Permission results

Each tool proposal resolves to:

- `allow_once`
- `allow_for_run`
- `allow_for_project`
- `always_allow_local`
- `deny_once`
- `always_deny_local`

Rules can match:

- tool name;
- normalized path;
- command and argument vector;
- URL origin;
- package registry;
- MCP server and tool;
- risk class;
- project trust state.

Precedence:

1. hard application safety deny;
2. explicit local deny;
3. project trust restriction;
4. explicit confirmation rule;
5. explicit allow;
6. profile default;
7. global default.

Approval cards show:

- requested action;
- exact target;
- risk explanation;
- affected files/origin/command;
- data leaving the browser, if any;
- requested scope;
- editable arguments when safe;
- approve and deny options.

### 13.3 Project trust

New imported/local projects begin untrusted.

While untrusted:

- project instruction files are visible but not automatically injected;
- project skills are disabled;
- terminal auto-approval is disabled;
- package scripts do not run automatically;
- remote MCP configuration in the repository is ignored;
- preview is isolated;
- the UI explains why.

Trust is a local, revocable decision recorded in the audit log.

---

## 14. Context engine

### 14.1 Sources

Rank context sources:

1. explicit user selection;
2. explicit `@file`, `@folder`, `@symbol`, `@diagnostics`, `@diff`, or `@terminal`;
3. active file and nearby selection;
4. current plan and accepted decisions;
5. relevant instructions and invoked skills;
6. lexical/symbol retrieval;
7. optional semantic retrieval;
8. verified project memory;
9. compacted older thread history.

Every context item includes source, path/URI, revision/hash, byte count, token estimate, and reason for inclusion.

### 14.2 Repository indexing

- Build a file manifest without reading ignored binaries.
- Respect `.gitignore` plus SourAI excludes.
- Detect binary files and size limits.
- Maintain a content-hash incremental lexical index in a worker.
- Add tree-sitter WASM symbol indexes only for supported languages.
- Use local embeddings only as an optional, lazy feature.
- Never upload a repository to build an index.

### 14.3 Instructions

Support:

- personal local instructions;
- project `AGENTS.md`;
- compatible project instruction files such as `CLAUDE.md` when enabled;
- nested directory instructions applied only within their scope.

Rules:

- show all loaded instruction sources;
- project instructions load only after project trust;
- higher-specificity directory instructions override general guidance only in their scope;
- instructions cannot override hard safety or user intent;
- instructions are content, not authority.

### 14.4 Skills

A skill is a local package containing:

- metadata (`name`, `description`, version);
- `SKILL.md`;
- optional templates/assets/scripts that are compatible with the browser runtime.

Skills can be:

- manually invoked with `/skill` or `@skill`;
- model-invoked only if allowed;
- scoped globally or per project;
- exported/imported as a reviewed archive.

Project skills require trust. A skill may not edit its own instruction source without explicit approval.

### 14.5 Memory

Memory kinds:

- verified project facts;
- user preferences;
- architectural decisions;
- run summaries.

Each memory includes provenance, project revision, confidence, created time, last verified time, and optional expiry.

The agent may propose memory. It may not store unverified assumptions as fact. Users can inspect, edit, export, or delete every memory.

### 14.6 Compaction

Compaction retains:

- user goals and constraints;
- accepted decisions;
- current plan and status;
- changed file summaries with hashes;
- tool results needed for continuation;
- unresolved errors and approvals;
- explicit user preferences.

Compaction drops:

- redundant token deltas;
- large file content that can be re-read;
- repeated logs;
- hidden reasoning;
- stale tool output.

---

## 15. In-browser execution

### 15.1 WebContainer

Use WebContainer for supported JavaScript/TypeScript/WASM projects.

Requirements:

- lazy-load `@webcontainer/api`;
- configure required COOP/COEP headers;
- boot at most once;
- display boot, compatibility, memory, and third-party-cookie errors clearly;
- mount a project snapshot instead of exposing arbitrary local handles;
- synchronize runtime file changes through the sync engine;
- stream stdout/stderr to an xterm-compatible terminal;
- capture `server-ready` and render previews in an isolated frame;
- stop orphan processes when a project closes;
- maintain a process table with command, cwd, start time, status, and owner run;
- verify production licensing before making the feature generally available.

WebContainer does not support native addons unless they are available in browser-compatible/WASM form. Detect known failures and explain them.

Only one WebContainer may be active in the page. Parallel agents share a runtime queue.

### 15.2 Pyodide

Use Pyodide in a module worker.

- Load only when a Python task is requested.
- Mirror the required project subset into Pyodide's filesystem.
- Capture stdout/stderr and exceptions.
- Support packaged Pyodide modules and pure-Python wheels where compatible.
- Expose package incompatibility clearly.
- Synchronize files after execution through the same revision protocol.
- Enforce time/output budgets and allow worker termination as the hard cancel path.

### 15.3 Browser tasks

Some verification can run without either runtime:

- JSON/YAML parsing;
- formatting using browser-safe libraries;
- TypeScript language-service diagnostics;
- ESLint-compatible browser bundles if practical;
- HTML/CSS analysis;
- unit tests designed for browser runners;
- diff and static checks.

### 15.4 Preview

- Prefer WebContainer dev-server URLs.
- For static files, use a sandboxed iframe with generated blob URLs or a service-worker-backed preview.
- Use the strictest iframe sandbox compatible with the project.
- Do not grant same-origin access to untrusted preview content.
- Capture console errors and unhandled exceptions through an explicit bridge.
- Never expose credential-vault values to preview frames.

---

## 16. Git and isolated parallel work

### 16.1 Git

Use isomorphic-git against a browser filesystem adapter for:

- init;
- clone where CORS/auth permits;
- status;
- diff support with application diff engine;
- log/show;
- branch create/list/checkout;
- add/reset;
- commit;
- fetch/pull/push where the remote permits browser access.

Use fine-grained user tokens or client-safe auth flows. Never embed a Git secret at build time.

Explicitly test and document limitations for:

- Git LFS;
- submodules;
- signed commits;
- credential helpers;
- arbitrary hooks;
- large repositories;
- SSH remotes;
- remote CORS.

### 16.2 Thread isolation

Since browser Git worktrees are not native OS worktrees:

- each isolated thread receives an OPFS snapshot manifest at a base revision;
- unchanged blobs are content-addressed and shared;
- changes create copy-on-write blobs;
- each thread has a logical branch name;
- merging produces a three-way diff against the current project revision;
- conflicts are shown in the review UI;
- application to a real local folder is explicit.

Threads operating directly on the same live project:

- may read concurrently;
- may not mutate concurrently;
- acquire a project mutation lease;
- queue or request isolated mode when another mutation run exists.

### 16.3 Subagents

Subagents are child runs, not hidden model conversations.

- parent proposes a bounded subtask;
- policy and budget are inherited with stricter limits;
- child has its own event stream and context;
- child cannot mutate the parent's live view unless assigned an isolated snapshot;
- child returns a structured result and artifacts;
- parent integrates the result;
- UI shows ownership, status, token/cost usage, and cancel controls.

Concurrency defaults depend on hardware capability and are capped.

---

## 17. Remote MCP in a client-only app

Support only MCP Streamable HTTP endpoints that:

- are HTTPS except explicit localhost development;
- permit the application origin through CORS;
- validate browser origins;
- support client-safe authentication;
- pass the local allowlist/policy.

Do not support local stdio MCP servers, because a web page cannot launch arbitrary local processes.

For each server:

- fetch and cache tool/resource/prompt catalogs;
- namespace all capabilities;
- show the exact remote origin;
- store auth in the local credential vault;
- apply individual tool permissions;
- validate schemas and bound results;
- redact secrets from logs;
- provide disconnect/revoke controls.

Treat MCP output as untrusted content. It cannot alter policy or silently invoke another tool.

---

## 18. User experience specification

### 18.1 Agentic layout

Desktop:

- left: thread sidebar and project switcher;
- center-left: agent panel;
- center: editor/review/preview;
- right: explorer, source control, problems, outline;
- bottom: terminal and output.

Responsive:

- panels become routable drawers/tabs;
- agent run status remains visible;
- no core action depends on hover.

### 18.2 Thread sidebar

Show:

- project grouping;
- thread title;
- agent/profile/model;
- status indicator;
- isolation badge;
- unread/attention state;
- usage summary;
- archive, restore, fork, export, and delete.

Persist fuzzy-search index locally.

### 18.3 Agent panel

Composer supports:

- multiline prompt;
- `@` context;
- `/` skills and commands;
- attachments;
- model and profile selectors;
- privacy/data destination indicator;
- estimated context usage;
- stop/steer;
- plan/write mode compatibility.

Timeline renders:

- user messages;
- assistant messages;
- plan/todo changes;
- tool cards;
- approvals;
- file transactions;
- checkpoints;
- verification;
- warnings/errors;
- final summary.

### 18.4 Review surface

Provide:

- changed-file list;
- unified and side-by-side diff;
- hunk-level accept/reject;
- edited-since-agent conflict marker;
- new/deleted/renamed indicators;
- checkpoint restore;
- apply to real folder;
- stage/unstage;
- verification status.

### 18.5 Terminal

- multiple named terminals;
- process list;
- command history local to project;
- stdout/stderr distinction;
- clear runtime badge (`WebContainer`, `Pyodide`, `Browser`);
- kill/restart;
- command-to-agent context attachment;
- no misleading OS shell branding.

### 18.6 Settings

Sections:

- Models and providers;
- Local models;
- Credentials and vault;
- Agent profiles;
- Tool permissions;
- Skills;
- Instructions;
- MCP;
- Git;
- Runtime;
- Storage and cleanup;
- Privacy and network;
- Usage and budgets;
- Audit;
- Accessibility;
- Import/export.

### 18.7 Accessibility

- WCAG 2.2 AA target;
- complete keyboard navigation;
- visible focus;
- semantic live regions for run status without announcing every token;
- reduced motion;
- sufficient contrast;
- resizable panels;
- screen-reader labels for diffs, approvals, and tool statuses.

---

## 19. Business-class local controls

The client-only edition can provide strong local governance, but must not misrepresent it as centrally enforced enterprise governance.

### Included

- named policy profiles;
- tool allow/confirm/deny rules;
- provider and endpoint allowlists;
- per-run and monthly local budgets;
- project trust;
- secret redaction;
- data-destination preview;
- local append-only audit log;
- audit export in JSONL/CSV;
- signed policy-file import verification using an embedded public key;
- encrypted settings/project export;
- configurable retention and local cleanup;
- no SourAI data collection by default;
- optional client telemetry with explicit consent.

### Not centrally enforceable without a backend

- user identity and organization membership;
- SSO/SAML and SCIM;
- tamper-proof RBAC;
- authoritative shared budgets or billing;
- central revocation;
- guaranteed audit retention;
- cross-device synchronization;
- legal hold;
- data-residency routing;
- server-verified license enforcement.

Product copy should call the included controls "local business controls" or "managed configuration import," not "enterprise enforcement."

---

## 20. Security model

### 20.1 Threats

- malicious repository instructions;
- prompt injection in source, docs, terminal output, web pages, or MCP results;
- path traversal and symlink confusion;
- model-generated destructive commands;
- dependency/package supply-chain attacks;
- credential leakage into prompts, runtime processes, logs, exports, or previews;
- XSS stealing locally stored credentials;
- untrusted preview escaping into the app origin;
- cross-tab write races;
- corrupted IndexedDB/OPFS state;
- excessive model/tool loops causing cost or browser exhaustion;
- malicious imported settings/skills/projects;
- network exfiltration by tools or project code.

### 20.2 Controls

- project trust gate;
- strict typed tool boundary;
- JSON-schema validation for inputs and outputs;
- canonical path validation;
- content-hash preconditions;
- transaction checkpoints;
- risk-based approval;
- bounded outputs and budgets;
- no secrets in project runtime;
- credential redaction and vault auto-lock;
- strict CSP and dependency pinning;
- no `dangerouslySetInnerHTML` for untrusted content;
- sanitized Markdown;
- sandboxed preview;
- URL origin allowlist and clear outbound indicators;
- worker isolation;
- cross-tab leases using Web Locks where available plus IndexedDB fallback;
- import archive validation, size limits, and zip-slip prevention;
- audit events for security-relevant settings and approvals.

### 20.3 Cloudflare Pages headers

Add and verify a static `_headers` policy. The exact CSP must be generated from actual dependencies, but the target includes:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), geolocation=(), payment=(), usb=()
```

Add a strict `Content-Security-Policy` after inventorying:

- provider origins;
- WebContainer requirements;
- local model/model-asset origins;
- worker and WASM loading;
- preview origins;
- optional telemetry.

Prefer self-hosted assets. Avoid wildcard `connect-src`. If user-configurable endpoints make a static CSP impossible, provide an explicit compatibility mode with a visible security tradeoff and keep the default locked down.

### 20.4 Audit events

Audit:

- project trust changes;
- provider/endpoint changes;
- vault lock/unlock/config changes, never secret values;
- profile/policy changes;
- approvals and denials;
- file transactions and checkpoint restores;
- terminal commands;
- Git mutations;
- MCP connections/calls;
- data export/import;
- audit deletion.

Hash-chain local audit events to make accidental mutation evident:

```text
eventHash = SHA-256(previousHash || canonicalEventWithoutHash)
```

This is tamper-evident within the exported log, not tamper-proof against a user controlling the browser.

---

## 21. Internal command and event contracts

### Commands

```ts
type AgentCommand =
  | { type: 'run.start'; requestId: string; projectId: string; threadId: string; input: RunInput }
  | { type: 'run.cancel'; requestId: string; runId: string }
  | { type: 'run.steer'; requestId: string; runId: string; message: string }
  | { type: 'approval.resolve'; requestId: string; approvalId: string; decision: ApprovalDecision }
  | { type: 'run.resume'; requestId: string; runId: string };
```

### Core event types

- `run.created`
- `run.status_changed`
- `context.assembled`
- `context.compacted`
- `provider.request_started`
- `provider.output_delta`
- `assistant.message_completed`
- `tool.proposed`
- `tool.validation_failed`
- `approval.requested`
- `approval.resolved`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `file.transaction_started`
- `file.transaction_completed`
- `file.conflict`
- `checkpoint.created`
- `checkpoint.restored`
- `todo.changed`
- `usage.changed`
- `run.waiting_for_user`
- `run.completed`
- `run.failed`
- `run.cancelled`

Persisted payloads must not contain credentials or hidden reasoning.

### Errors

Normalize errors:

```ts
interface SourError {
  code: string;
  message: string;
  retryable: boolean;
  userAction?: string;
  details?: Record<string, unknown>;
  causeCategory:
    | 'provider'
    | 'policy'
    | 'filesystem'
    | 'runtime'
    | 'git'
    | 'storage'
    | 'network'
    | 'validation'
    | 'unsupported'
    | 'cancelled';
}
```

Never show raw provider/network errors without secret redaction.

---

## 22. Migration strategy

Do not rewrite the UI and runtime in one change. Migrate behind feature flags while maintaining a working build.

### Phase 0 — Baseline and safety net

Deliver:

- architecture decision records for client-only and runtime choices;
- Vitest, React Testing Library, Playwright, and worker test harness;
- fixtures for virtual and real-folder projects;
- current critical-flow smoke tests;
- bundle analysis;
- feature-flag framework;
- error boundary and normalized error type.

Gate:

- existing chat/workspace opens;
- TypeScript, unit tests, and production build pass;
- baseline bundle and interaction metrics recorded.

### Phase 1 — Contracts, storage, and component decomposition

Deliver:

- typed events/commands/errors;
- IndexedDB schema and migrations;
- OPFS blob store;
- repository layer;
- domain store derived from events;
- split `AgentPanel` into view components;
- migrate threads/settings/context from `localStorage`;
- import old local data once, with rollback/export.

Gate:

- reload reconstructs every thread from persisted data;
- migration tests cover empty, normal, corrupt, and interrupted states;
- no canonical thread state remains in `localStorage`.

### Phase 2 — Unified filesystem and safe changes

Deliver:

- common filesystem contract;
- OPFS and local-folder adapters;
- sync engine;
- project revisions and hashes;
- transaction journal;
- checkpoints and restore;
- diff/review UI;
- conflict handling.

Gate:

- randomized transaction tests never escape root or produce partial commits;
- external local-file changes cause a conflict, not overwrite;
- checkpoint restore is byte-identical.

### Phase 3 — Client provider layer and structured agent

Deliver:

- provider registry;
- direct BYOK adapters for providers proven to support browser CORS;
- WebLLM adapter behind capability flag;
- credential vault;
- run state machine;
- structured tool registry;
- read-only tools first;
- streaming/cancel/retry/budget behavior;
- privacy preview.

Then:

- stop calling `/api/agent` and `/api/chat`;
- remove server prompt protocol from active code;
- delete `functions/` only after all active flows are client-direct;
- remove server-only environment examples and documentation.

Gate:

- no SourAI API request appears in an end-to-end network trace;
- malformed model tool calls cannot reach execution;
- cancellation leaves a resumable event stream;
- credentials never appear in persisted events or logs.

### Phase 4 — Editing and verification

Deliver:

- patch/write/delete/move/batch tools;
- profile and policy engine;
- approval cards;
- transaction/tool integration;
- diagnostics tools;
- automatic verification hooks;
- hunk review.

Gate:

- all mutations require revision preconditions and checkpoints;
- Ask/Plan cannot mutate even if the model requests it;
- deny rules cannot be bypassed by prompt content;
- changed files and verification results match the final summary.

### Phase 5 — Browser terminal, Git, and preview

Deliver:

- WebContainer licensing decision and integration;
- COOP/COEP headers;
- process manager and terminal UI;
- Pyodide worker;
- Git adapter;
- preview lifecycle and error bridge;
- runtime compatibility diagnostics.

Gate:

- supported JS project can install, test, run, and preview entirely in-browser;
- supported Python script runs without blocking UI;
- process cancellation works;
- unsupported native dependencies produce a precise capability error;
- no credential is visible to runtime processes or preview frames.

### Phase 6 — Context, instructions, skills, memory, and MCP

Deliver:

- incremental lexical index;
- optional symbol index;
- context inspector and provenance;
- trusted instruction loading;
- skill catalog and invocation;
- verified memory;
- remote Streamable HTTP MCP client;
- context compaction.

Gate:

- context source list exactly matches sent content;
- untrusted project instructions are not injected;
- MCP cannot bypass local permissions;
- compaction preserves task state in replay tests.

### Phase 7 — Parallel threads and subagents

Deliver:

- thread sidebar/history/import/export;
- mutation leases;
- copy-on-write isolated snapshots;
- three-way merge;
- child-run/subagent model;
- concurrency and device budgets;
- runtime command queue.

Gate:

- two isolated threads can change the same base without silent overwrite;
- shared-project mutation is serialized;
- cancelling a child does not cancel unrelated runs;
- memory pressure degrades concurrency safely.

### Phase 8 — Advanced Zed-like workflows

Deliver:

- inline assistant;
- opt-in edit prediction;
- commit-message generation;
- command palette;
- reusable prompt templates;
- terminal-to-agent context;
- diagnostics-to-agent quick fixes;
- polished keyboard navigation.

Gate:

- every feature has independent privacy and provider controls;
- edit prediction is off by default for remote providers until user consent;
- inline edits use the same transaction/review layer.

### Phase 9 — Local business controls and PWA hardening

Deliver:

- local audit log and export;
- policy import/export/signature verification;
- local usage/cost dashboard;
- retention and cleanup;
- encrypted recovery bundles;
- PWA install/offline shell;
- CSP and supply-chain hardening;
- accessibility audit;
- telemetry consent;
- user-facing capability documentation.

Gate:

- offline application shell and local projects reopen;
- remote-required actions explain connectivity;
- no analytics request occurs before consent;
- audit chain verifies after export/import;
- WCAG target is met for primary flows.

### Phase 10 — Release hardening

Deliver:

- agent conformance evaluation suite;
- security tests;
- load/performance tests;
- browser compatibility matrix;
- storage corruption and quota recovery drills;
- release checklist and rollback strategy;
- removal of obsolete code/docs.

Gate:

- all Definition of Done items below pass;
- network trace proves the no-backend architecture;
- production Pages deployment headers pass automated verification.

---

## 23. Testing strategy

### Unit tests

- path normalization and traversal rejection;
- policy precedence;
- JSON-schema tool validation;
- run state transitions;
- budgets and cancellation;
- event reducers and replay;
- context ranking/deduplication;
- redaction;
- cryptographic envelope format;
- patch application and conflict detection;
- provider stream parsers;
- migrations.

### Contract tests

- provider adapters against recorded sanitized fixtures;
- worker message protocol;
- filesystem adapters against a shared behavior suite;
- runtime adapters against capability fixtures;
- MCP schema/transport fixtures;
- import/export version compatibility.

### Integration tests

- user prompt to read-only tool loop;
- approval pause and resume;
- multi-file edit/checkpoint/review;
- runtime test execution;
- preview error capture;
- Git commit;
- local folder external conflict;
- vault lock during a run;
- storage quota failure;
- provider disconnect/retry;
- corrupted event recovery.

### End-to-end browser tests

At minimum:

- Chromium full path;
- Firefox without unsupported features;
- Safari/WebKit degraded path;
- keyboard-only flow;
- offline reload;
- private-mode warning;
- capability-disabled UI;
- Cloudflare Pages production headers.

### Security tests

- prompt injection attempts to override policy;
- malicious `AGENTS.md`;
- malicious skill archive;
- zip-slip import;
- path traversal variants;
- dangerous command approval;
- secret canary scanning across logs/events/exports/prompts;
- Markdown/XSS payloads;
- preview-origin isolation;
- MCP oversized/malformed results;
- provider error secret leakage;
- cross-tab mutation races.

### Agent evaluations

Build deterministic repositories and score:

- correct file discovery;
- minimal relevant reads;
- patch correctness;
- no unauthorized mutation;
- verification after edits;
- recovery from a failed command;
- instruction hierarchy;
- tool argument conformance;
- context efficiency;
- summary accuracy;
- cost and turn count.

Run evaluations per supported model before listing it as "recommended."

---

## 24. Quality and performance targets

- Main-thread long tasks over 50 ms are treated as regressions in primary flows.
- Initial route does not download WebContainer, Pyodide, WebLLM, language-service bundles, or all CodeMirror languages.
- Initial compressed JavaScript target: under 500 KB, excluding lazy editor language chunks.
- Thread list with 1,000 archived threads remains interactive.
- Event replay for a normal thread completes in under 500 ms on reference hardware.
- Search returns first results progressively and is cancellable.
- Provider cancellation begins within 250 ms of user action.
- Terminal output remains responsive under bounded high-volume output.
- No lost accepted file transaction after a successful commit event.
- Project open for 10,000 files uses progressive enumeration and does not freeze the UI.
- Runtime/model memory pressure is detected and results in safe feature degradation.

These are engineering targets, not marketing promises, until measured in CI and production.

---

## 25. Definition of Done

The reimplementation is complete only when:

- the production application is a static Pages deployment;
- no SourAI backend or Pages Function is called;
- no private credential is embedded in built assets;
- agent orchestration runs in a browser worker;
- all model tool calls are structured and schema-validated;
- no active code parses `@@readfile`, file fences, or similar prose as executable instructions;
- all file mutations are transactional, revision-checked, checkpointed, diffed, and reversible;
- Ask and Plan profiles are technically unable to mutate;
- terminal/runtime behavior is labeled with honest compatibility limits;
- local threads survive reload and reconstruct from an event log;
- OPFS/IndexedDB migrations and recovery are tested;
- project trust governs repository instructions and skills;
- credentials are session-only by default and redacted everywhere;
- remote data destinations are visible before content is sent;
- remote MCP is permission-gated and local stdio MCP is not falsely offered;
- parallel mutation cannot silently overwrite work;
- audit, usage, settings, threads, and project bundles can be exported;
- the application passes TypeScript, lint, unit, integration, E2E, security, accessibility, and production-build checks;
- Cloudflare Pages serves required security and cross-origin isolation headers;
- unsupported browser/OS features fail with actionable explanations;
- obsolete server code and documentation are removed after migration.

---

## 26. Decisions that must be made before implementation reaches Phase 5

These are product/licensing decisions, not architecture ambiguity:

1. WebContainer commercial licensing and origin credential requirements.
2. Exact direct-browser providers whose CORS and terms permit BYOK requests.
3. Which local WebLLM models meet the tool-conformance bar and acceptable download size.
4. Whether the default Cloudflare Pages CSP uses `require-corp` or a tested `credentialless` WebContainer configuration.
5. Supported browser tiers:
   - Tier A: Chromium with local folders and WebContainer;
   - Tier B: browsers with OPFS and reduced runtime support;
   - Tier C: read/edit/chat only.
6. Maximum supported project size and checkpoint retention defaults.
7. Whether optional telemetry exists; default remains off.
8. Public naming for local controls so they are not confused with centrally enforced enterprise controls.

---

## 27. Reference sources

Capability benchmark:

- Zed agents: https://zed.dev/docs/ai/agents
- Zed Agent: https://zed.dev/docs/ai/zed-agent.html
- Agent profiles: https://zed.dev/docs/ai/agent-profiles
- Tool permissions: https://zed.dev/docs/ai/tool-permissions
- Agent tools: https://zed.dev/docs/ai/tools
- Parallel agents: https://zed.dev/docs/ai/parallel-agents
- Instructions: https://zed.dev/docs/ai/instructions
- Skills: https://zed.dev/docs/ai/skills
- MCP: https://zed.dev/docs/ai/mcp
- Privacy and security: https://zed.dev/docs/ai/privacy-and-security

Browser implementation:

- OPFS: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- WebContainer API: https://webcontainers.io/api
- WebContainer quickstart: https://webcontainers.io/guides/quickstart
- WebContainer headers: https://webcontainers.io/guides/configuring-headers
- WebContainer troubleshooting and native-addon limits: https://webcontainers.io/guides/troubleshooting
- WebContainer commercial usage FAQ: https://developer.stackblitz.com/guides/user-guide/general-faqs
- Pyodide in a worker: https://pyodide.org/en/stable/usage/webworker.html
- Pyodide browser constraints: https://pyodide.org/en/stable/usage/wasm-constraints.html
- isomorphic-git browser filesystem model: https://isomorphic-git.org/docs/en/0.76.0/fs
- WebLLM: https://webllm.mlc.ai/docs/
- Transformers.js/WebGPU: https://huggingface.co/docs/transformers.js/en/guides/webgpu
- MCP Streamable HTTP: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
