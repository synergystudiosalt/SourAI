# Architecture decision records

Each record states a decision that is expensive to reverse, the constraints
that forced it, and what it costs. They are written so that a future engineer
can tell whether a decision still holds without re-deriving it.

Records are immutable once accepted. A changed decision gets a new record that
supersedes the old one; the old one stays, marked superseded.

| # | Decision | Status |
|---|---|---|
| [0001](0001-client-only-architecture.md) | Client-only architecture on Cloudflare Pages | Accepted |
| [0002](0002-local-persistence.md) | IndexedDB for metadata, OPFS for content | Accepted |
| [0003](0003-execution-runtimes.md) | In-browser execution runtimes and capability tiers | Accepted |
| [0004](0004-structured-tool-protocol.md) | Structured tool calls replace the prose protocol | Accepted |
| [0005](0005-credential-handling.md) | BYOK, session-scoped by default | Accepted |
| [0006](0006-bundle-strategy.md) | Lazy runtimes and an enforced bundle ratchet | Accepted |

## Template

```markdown
# NNNN. Title

Status: Proposed | Accepted | Superseded by NNNN
Date: YYYY-MM-DD

## Context
What forces this decision. Include the constraints that are not negotiable.

## Decision
What we are doing, stated so it can be checked against the code.

## Consequences
What this costs, what it forecloses, and what has to be true for it to keep
working. Include the honest limitations.

## Alternatives considered
What was rejected and why.
```
