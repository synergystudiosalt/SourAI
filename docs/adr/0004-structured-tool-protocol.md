# 0004. Structured tool calls replace the prose protocol

Status: Accepted
Date: 2026-07-27

## Context

The agent currently instructs the model, in its system prompt, to emit markers
inside its prose. `src/utils/agentProtocol.ts` then scans that prose with
regular expressions and executes what it finds:

```
@@readfile: path            @@replace: path ||| search ||| replace
@@delete: path              @@rename: old ||| new
@@findall: query            ```lang path="src/App.tsx" … ```
```

There is no boundary between text the model is *showing* the user and text that
*commands the runtime*. The consequences are demonstrated in
`src/utils/agentProtocol.test.ts`:

- **Prose is executable.** A model quoting a file, a README, or a user-supplied
  document that happens to contain `@@delete: src/index.ts` deletes that file.
  Any content the model relays is an injection vector.
- **Malformed calls vanish.** `@@replace` with a missing `|||` produces no
  request and no error; the run continues as though the edit was never asked
  for.
- **Truncated output loses work silently.** A stream cut mid-fence yields no op
  at all, with nothing to signal that an edit was intended.
- **No preconditions.** A write op carries a path and full content. Nothing
  records which revision the model read, so a concurrent edit is overwritten
  without a conflict.
- **No validation, no versioning, no idempotency.** Arguments are whatever the
  regex captured. There is no schema to reject `../../etc/passwd`.

## Decision

Every tool call is a versioned, schema-validated structured call. No active code
path parses prose as an instruction.

Each tool is declared by a `ToolDefinition` carrying a name, a version, a risk
class, required capabilities, a JSON Schema for input, a JSON Schema for output,
and a summariser used to render the approval card. Dispatch is:

1. resolve the tool name against the registry — unknown name is a hard failure;
2. validate arguments against the versioned input schema;
3. normalise paths and URLs canonically, rejecting traversal, absolute paths,
   NUL bytes, and reserved namespaces;
4. classify risk and consult profile availability and permission rules;
5. auto-deny, request approval, or execute;
6. validate and size-bound the result before it re-enters the model context.

Every transition is persisted as an event. Results have hard byte limits with
structured truncation metadata; anything larger becomes a local artefact
referenced by id.

Mutating tools additionally carry the project revision and an expected content
hash (or an explicit create-only precondition). Multi-file edits are applied as
a transaction: validate all preconditions, checkpoint, stage, compute hashes and
diffs, commit the manifest atomically. One conflicting file aborts the whole
transaction unless the user explicitly chooses partial application.

Models that cannot do structured tool calling well are handled by a constrained
JSON compatibility adapter whose output is still parsed and validated as a
standalone envelope. It never restores prose parsing. A profile whose required
tool contract exceeds a model's capability cannot be selected with that model.

Hidden chain-of-thought is not requested, not stored, and not displayed. The
activity log shows plans, todos, tool inputs and outputs, decision summaries,
verification results, and errors.

## Consequences

- Injection through relayed content stops being a code-execution path. Content
  is data; only the structured channel carries commands.
- Malformed calls fail loudly and are visible in the event log, so a failed run
  is diagnosable instead of mysteriously incomplete.
- Path validation has one enforced choke point rather than being spread across
  call sites.
- Preconditions make concurrent-edit conflicts detectable, which is what makes
  checkpoints and review trustworthy.
- Cost: provider capability now matters. Weak-tool-calling models need the
  compatibility adapter and must pass a conformance evaluation before being
  listed as recommended.
- Cost: adding a tool means writing two schemas, a summariser, a risk class, and
  tests. That friction is deliberate — every tool is a new way for the agent to
  affect the user's machine.

## Alternatives considered

**Harden the regex parser.** Rejected. Stricter patterns reduce the injection
surface without removing it, because the channel itself is shared with prose.
There is no regex that distinguishes "the model is quoting this" from "the model
means this".

**XML-tagged tool calls.** Rejected. Better delimited than bare markers, but
still text-in-prose with no schema, and it inherits the truncation problem.

**Provider-native function calling only.** Rejected as the sole mechanism. It is
the preferred path, but it would exclude every provider and local model without
solid tool support. The compatibility adapter exists for exactly that case.
