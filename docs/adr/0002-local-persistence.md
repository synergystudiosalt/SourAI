# 0002. IndexedDB for metadata, OPFS for content

Status: Accepted
Date: 2026-07-27

## Context

All durable state lives on the user's device (see
[0001](0001-client-only-architecture.md)). The state is not small or uniform: it
spans settings, projects, threads, an append-only run event log, tool calls,
approvals, checkpoints, file blobs, search indexes, usage, and audit records.

Today the application stores its canonical state in `localStorage`:

| Key | Contents |
|---|---|
| `sourbot_agent_thread::<projectId>` | the entire agent conversation |
| `sourbot_context::<projectName>` | persistent context memory |
| `sourbot_agent_mode`, `sourbot_agent_model` | agent settings |
| `sour_workspace_virtual_project` | the whole virtual project tree |
| `sour_custom_apis` | custom endpoint configuration |
| `sour_msg_units`, `sour_limit_reset_time`, `sour_dark_mode` | quota and theme |

`localStorage` is synchronous, string-only, roughly 5 MB per origin, has no
schema, no transactions, no indexes, and no way to detect a partial write. A
project tree and a conversation history stored there will hit the quota, block
the main thread while serialising, and corrupt silently when a write is cut
short. It also gives no way to migrate a shape once it changes.

## Decision

Two stores, chosen by access pattern.

**IndexedDB — transactional metadata.** Everything that is queried, indexed,
or written as part of a transaction: settings, projects, filesystem descriptors,
serialised directory handles, threads, messages, runs, events, tool calls,
approvals, profiles, policies, skills, instructions, MCP configuration, provider
configuration, usage, audit records, checkpoint manifests, index manifests,
cross-tab leases, and the schema version.

**OPFS — bytes.** Virtual project files, content-addressed blobs, checkpoint
data, attachments, search indexes, model artefacts where the model library does
not manage its own cache, and export staging. OPFS gives synchronous access
handles inside a worker, which is what makes large-file work possible without
stalling the UI.

**`localStorage` — nothing that matters.** Only tiny preferences needed before
the database opens: theme, last route, and development-only feature-flag
overrides. Never threads, projects, messages, memory, quota, or credentials.

Supporting rules:

- Every persisted object carries a schema version. Migrations are forward-only,
  idempotent, resumable after interruption, and tested against fixtures from
  every released schema.
- The run event log is the source of truth; UI state is derived from it. Replay
  of an event stream must reconstruct the same visible run state.
- Sequence numbers are monotonic within a run; duplicate event IDs are ignored.
- Irreversible transitions are persisted before they are rendered. Token deltas
  may be batched; tool lifecycle transitions and final assistant content may not.
- A destructive repair exports an encrypted recovery bundle first. The only copy
  of project content is never deleted automatically.

## Consequences

- Reload reconstructs threads exactly, including a run interrupted mid-flight.
  This is the property that makes "resume" honest rather than approximate.
- Heavy I/O moves into a storage worker, so opening a 10,000-file project does
  not freeze the UI.
- Migration is now a first-class concern with its own test surface. Every schema
  change costs a migration and a fixture. That cost is the point: it is what
  stops a release from eating a user's threads.
- Cross-tab writes need leases (Web Locks, with an IndexedDB fallback). Two tabs
  mutating one project is a real scenario, not a theoretical one.
- Storage is evictable. Quota must be surfaced, `navigator.storage.persist()`
  requested with an explanation, and private-mode sessions warned about.

## Alternatives considered

**Keep `localStorage`, add compression.** Rejected. It postpones the quota wall
by a constant factor and fixes none of the corruption, transaction, indexing, or
migration problems.

**A single IndexedDB store for both metadata and file bytes.** Rejected. Large
blobs in IndexedDB are slower to read and write than OPFS access handles and
make quota accounting opaque. Splitting by access pattern keeps each store good
at its job.

**OPFS for everything, with a hand-rolled index.** Rejected. That means writing
a transactional key-value store with secondary indexes from scratch, which is
what IndexedDB already is.
