# 0001. Client-only architecture on Cloudflare Pages

Status: Accepted
Date: 2026-07-27

## Context

The product must run as a static deployment on Cloudflare Pages with no
application backend: no Pages Functions in the request path, no Worker API, no
Durable Objects, D1, R2, KV, or Queues holding application state, no remote
workspace VM, and no server-side database.

The repository today does not satisfy this. `functions/api/agent.ts` and
`functions/api/chat.ts` are Pages Functions that receive prompts, file contents,
and conversation history, and hold the provider API keys in server environment
variables. Every agent turn and every chat message goes through them.

Two facts constrain the target:

1. Vite inlines `VITE_`-prefixed variables into the browser bundle as literal
   text. Anything placed there is readable by anyone who loads the app. There is
   no build configuration that makes a client-visible variable secret.
2. A browser cannot launch a local process, open a raw socket, or read the
   filesystem outside what the user explicitly grants. Some capabilities of a
   desktop coding agent are therefore not reproducible, not merely harder.

## Decision

The application is client-authoritative. Cloudflare Pages supplies static asset
hosting, response headers (`_headers`), SPA routing (`_redirects`), CDN caching,
and public build configuration — nothing else.

Concretely:

- The agent loop runs in a dedicated browser worker, not on a server and not on
  the React main thread.
- Model requests go from the browser directly to a user-selected provider using
  the user's own credentials (BYOK), or to a local WebGPU model.
- Project files, threads, runs, events, approvals, checkpoints, settings, and
  audit records live in IndexedDB and OPFS on the user's device.
- Any outbound request is to a third party the user configured — a provider, a
  Git host, a package registry, a remote MCP server — never to a SourAI-owned
  endpoint.

Capabilities that a browser cannot provide are detected and disabled with an
explicit explanation. They are never simulated and never described as working.
This applies to arbitrary native binaries, local stdio MCP servers, OS-level Git
worktrees, background execution after the tab closes, and every form of
server-enforced organisation policy (SSO, SCIM, RBAC, tamper-proof audit
retention, central revocation).

The legacy `functions/` path stays in place and functional until the client
replacement reaches parity. Removal is gated on an end-to-end network trace
showing no `/api/*` request — see `e2e/no-backend.spec.ts`.

## Consequences

What this buys:

- Project code and prompts never transit infrastructure operated by this
  project. That is the strongest privacy claim available, and it is structural
  rather than policy-based.
- No server to secure, scale, bill, or breach. No shared provider key to leak.
- Deployment is a static upload; rollback is a redeploy.

What this costs, stated plainly:

- **Credentials are the user's problem.** There is no shared key, so a first
  run requires the user to supply one. This is a real onboarding cost.
- **Provider reach is limited by CORS.** Only providers that permit browser
  requests can be used directly. A provider that blocks browser origins cannot
  be supported without a proxy, and a proxy is a backend.
- **No centrally enforced governance.** Local policy profiles can be exported,
  imported, and signature-checked, but a user with devtools controls their own
  browser. Product copy must say "local business controls", never "enterprise
  enforcement".
- **No tamper-proof audit.** A hash-chained local log is tamper-*evident*, which
  is a weaker and different claim.
- **Nothing runs while the tab is closed.** Runs are persisted and resumable;
  they do not continue in the background. The UI must never imply otherwise.
- **Storage is evictable.** Persistent storage is requested, not guaranteed,
  and private-mode sessions may not survive at all.

For this to keep working: every feature added must be checked against "can a
browser actually do this, in the browsers we support?" before it is designed,
not after it is built.

## Alternatives considered

**Keep a thin Cloudflare Worker proxy for model calls.** Rejected. It solves
CORS and lets the product ship a shared key, but it puts every prompt and every
file the agent reads through infrastructure this project operates. That negates
the core privacy property and re-introduces the entire class of problems the
architecture exists to avoid.

**Hybrid: static app, optional self-hosted proxy.** Deferred, not rejected. It
does not violate the constraint as long as the default path is direct and the
proxy is the user's own deployment. Out of scope for this migration.

**Electron or a desktop build.** Rejected for this product. It would remove the
capability limits, but the requirement is a browser application on Pages.
