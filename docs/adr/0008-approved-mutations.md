# 0008. Approved, transaction-backed workspace mutation

Status: Accepted
Date: 2026-07-28

## Context

Phase 4A gave the agent real project content and read-only tools. Letting it
change files raises a different question: what, exactly, authorizes a write?

The pieces already existed. `WorkspaceTransactionEngine` had revision and hash
preconditions, checkpoints, journalling, and rollback. The tool registry
carried a `propose-mutation` risk level. What did not exist was a path from a
model's suggestion to a file on disk, and the previous attempt at one — a
boolean `approvalGranted` flag threaded through the tool executor — is exactly
the design that cannot be trusted: a boolean says "someone approved something",
not "this user approved *these bytes* to *these files* at *this revision*,
once".

Two structural facts shaped the answer.

The **model runs in a worker**, and the worker holds only a read-only snapshot
copy of the project. The **authoritative project lives on the host** — in the
editor's state for browser-native projects, behind File System Access handles
for local folders. Nothing in the worker can legitimately write a file.

## Decision

**The approval artifact replaces the boolean.** `ApprovalCoordinator` mints a
one-use token bound to the proposal digest, project, thread, run, tool call,
project revision, affected paths, an expiry, and a random nonce that never
leaves memory. `consume()` checks every binding and retires the token in the
same synchronous step, so a double-clicked button cannot apply twice. A
forged artifact fails on the nonce; a stale one fails on the revision; an
edited proposal fails on the digest.

**Approval lives on the host, not in the worker.** The reviewer, the
coordinator, the authoritative filesystem, and the transaction engine are all
host-side, next to the diff the user is actually looking at. The worker can
only ask. This is stronger than minting tokens in the worker, where model
output and authorization logic would share a process.

**The worker still owns the event log.** The host reports what it did; the
worker validates that report structurally and appends `proposal.created`,
`approval.requested`, `approval.resolved`, `checkpoint.created`,
`file.transaction_started`, `approval.consumed`,
`file.transaction_completed` (or `file.conflict` /
`file.transaction_rolled_back`), and the verification events. One writer, one
ordered log, replayable into the same review state.

**Risk comes from the registry descriptor.** `ToolRegistry.isMutating` answers
from the immutable descriptor and treats an unknown name as mutating. Capability
policy is checked *before* arguments are parsed, so an Ask-mode call cannot
reach a mutation tool's parser, let alone its handler. Mutation tools are only
registered at all when a reviewer exists; without one the composition is
structurally read-only.

**Patching is deterministic and refuses ambiguity.** Every hunk quotes the
original lines it replaces and is verified byte for byte at its recorded
position. There is no fuzzy matching anywhere: an edit that has moved produces
a conflict, not a relocated write. Line endings and trailing-newline state are
preserved by representing a trailing newline as a final empty line, which makes
decode/encode exactly reversible for every input.

**Selecting part of a change produces a new change.** Keeping some files or
hunks builds a fresh proposal from the selection — a partially-kept whole-file
rewrite becomes a patch — and re-derives its digest. What is applied is what
was selected, and the original proposal is recorded as superseded.

**A proposal carrying a credential is refused, not redacted.** Redacting would
silently corrupt the content the user approved; writing it would put the key in
a file. The model is told why instead.

## Consequences

- Local-folder projects remain read-only to the agent. File System Access does
  not provide an atomic multi-file commit/rename primitive, so claiming success
  from a memory transaction and mirroring it afterward would be unsafe.
  Mutation tools are therefore not composed for a real-folder workspace until
  the local-folder adapter can be the checked transaction target itself.
- Editor edits during a review advance the workspace revision, which invalidates
  a pending approval. That is a deliberate false-positive bias: the user is
  asked for a fresh proposal rather than having their typing overwritten.
- Verification is limited to what a browser can actually do today — applied
  content hashes and JSON parsing. Recommended commands like `npm test` are
  reported as `unavailable` rather than omitted, so a summary cannot imply that
  tests ran. Real command execution waits for the Phase 5 runtime.
- The worker's cached project revision, used only for the `proposal.created`
  event, can lag the host by one sync. The revision that matters — the one the
  artifact binds to — is read fresh on the host at request time.
- Proposal bodies are stored outside the event log, keyed by approval id, so a
  reload during review can rebuild the diff. They are deleted when the proposal
  settles. A review restored after reload can still be applied or discarded, but
  the run that produced it has ended and is not resumed.
- Checkpoint bytes are session-scoped in this phase. Undo is offered only while
  the originating in-memory workspace is alive and is refused if its revision
  has advanced. Durable reload/crash recovery remains a later workspace-storage
  phase; the UI must not claim that a checkpoint survived reload.
- **Two tabs on the same project are not coordinated.** Each tab holds its own
  authoritative copy and its own revision counter, so two tabs applying changes
  concurrently can overwrite each other through the shared project storage. The
  revision and hash preconditions protect a tab from *itself* and from the
  editor, not from a second tab. The `leases` store exists in the schema for
  this; nothing writes to it yet. Until it does, this is a known gap rather than
  a solved problem.

## Alternatives considered

**Run the transaction inside the worker over a filesystem RPC.** Keeps the
coordinator in one place and is the natural shape once the workspace itself
moves into a worker. Rejected for now: it needs an async transactional protocol
across a message port, and the host would still have to apply the result to
editor state afterwards, so the authoritative copy would exist twice either way.

**Keep the boolean `approvalGranted` and gate the tool handler on it.** Simple,
and wrong in the way this phase exists to fix: a flag can be set by any caller,
carries no binding to what was approved, and cannot express single use.

**Fuzzy patch placement.** Would make more proposals apply on the first try.
Rejected: an edit that lands somewhere other than where it was reviewed is an
unapproved change wearing an approval.
