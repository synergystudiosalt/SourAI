# 0007. The agent composition root and its context boundary

Status: Accepted
Date: 2026-07-28

## Context

Phase 3 left a complete set of parts — typed contracts, a worker runtime,
durable events, a provider registry, a structured tool registry, filesystem
adapters — and a production wiring that used none of them. The shipped worker
constructed a hardcoded echo provider and a no-op tool executor. The panel
displayed `local-fake` / `deterministic-v1` as if they were a model.

That is the failure mode Phase 4A exists to remove: parts that pass their unit
tests while the production path exercises something else.

Two questions had to be answered before anything could be assembled.

**Where does the agent get project content?** The authoritative project lives in
the editor's React state (virtual projects) or behind File System Access
handles (local-folder projects). Neither is reachable from a worker, and the
OPFS adapter is empty unless the OPFS project flag is on.

**Which provider actually runs?** `@mlc-ai/web-llm` is not a dependency, so no
on-device model exists in this build.

## Decision

**One composition root.** `createAgentComposition` in
`src/agent/composition/` is the only place a provider, model, tool registry,
filesystem, context scope, and budget are combined. The worker owns no
defaults: it starts with nothing and gains a runtime only from a validated
`init` message. There is no fallback composition, so a misconfigured run fails
with a stated reason instead of quietly running a stand-in.

**The host filters the workspace; the worker filters it again.** The host builds
a bounded `WorkspaceSnapshotV1` — scoped, size-capped, hashed — and sends it to
the worker. Credential-shaped paths (`.env*`, private keys, `.git/**`, cloud
credential files) are removed before anything crosses the boundary, and the
`ContextScope` is re-applied to every tool read inside the worker. Two
independent checks, because one of them will eventually be wrong.

A snapshot copy, rather than a filesystem RPC, means the agent reads a
point-in-time view. Revisions and content hashes make staleness detectable.
When transactional editing lands the adapter is replaced, not extended.

**Read-only tools only.** No mutating descriptor is registered in this phase,
and every write path on the scoped filesystem rejects. Ask and Plan cannot
mutate because no code exists that could; Write cannot either, and says so.

**Providers are described, not assumed.** `PROVIDER_CATALOG` records what has
actually been verified about direct browser calls. WebLLM is listed as
unsupported with the real reason — the engine is not in the build — instead of
being offered and failing at run time. A custom endpoint requires the user to
see and approve its host before a provider object can be constructed at all.

**The demo provider stays, labelled.** It is named "Demo — deterministic echo
(not a model)", never the default, never first in the list, and states what it
is in its own output on every turn. It exists so the run pipeline can be
exercised offline. Removing it would leave a build with no runnable provider
until a key is entered; disguising it is what Phase 3 did wrong.

**Credentials travel beside the command, never inside it.** A BYOK value is a
sibling field of the worker message envelope, so it is not part of
`AgentCommandV1` and cannot reach the event log, replay, or an export. The
worker registers it as a redaction secret and drops it when the run reaches a
terminal state.

**Tool results are fed back as a bounded next turn.** The run loop collects tool
outputs during a turn and starts the next turn with them, consuming turn
budget. Results are rendered as user-role content with the runtime's own
statement of success or failure, because the OpenAI-shaped `tool` role requires
an assistant `tool_calls` message that this provider contract does not model.
The trade-off is protocol fidelity; the gain is that a model cannot restate a
failed tool as a success.

## Consequences

- The panel now requires an explicit provider choice. There is no implicit
  default, which is a deliberate reduction in convenience.
- Real reasoning requires a user's own API key. Until `@mlc-ai/web-llm` is
  added — a separate bundle and licence decision — this build has no on-device
  model, and it says so rather than implying otherwise.
- The context preview shown before a run is produced by the same builder the
  worker uses, so it is the request, not a description of it.
- Local-folder projects contribute only files the editor has already loaded;
  unread files are reported as excluded rather than sent as empty.

## Alternatives considered

**A filesystem RPC from the worker back to the host.** Always current, no
duplicated bytes, and the natural shape once mutations exist. Rejected for this
phase: it needs an async request/response protocol with its own validation and
failure semantics, and it puts every excluded path one adapter bug away from a
tool result. Filtering before the boundary makes the security property
structural rather than enforced.

**Construct an OPFS filesystem inside the worker for the active project.**
Smallest possible change, and wrong: OPFS projects are off by default, so the
agent would read an empty workspace and report confidently on nothing.

**Ship no provider until WebLLM is installed.** Honest, but it leaves the
composition root unexercised in production, which is the exact condition this
phase exists to end.

**Keep the deterministic provider as the default.** Rejected. A default that
looks like a model and is not one is the defect being removed.
