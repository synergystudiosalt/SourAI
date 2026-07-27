# 0005. BYOK, session-scoped by default

Status: Accepted
Date: 2026-07-27

## Context

With no backend, the browser holds whatever credential is used to reach a model
provider. There is nowhere else to put it.

Two things follow, and neither is negotiable:

1. **A build-time variable is not a secret.** Vite inlines `VITE_`-prefixed
   values into the bundle as literal text. `.env.example` currently documents
   `GEMINI_API_KEY` and `GROQ_API_KEY` as *server* variables consumed by Pages
   Functions — correct today, and exactly what must not migrate to the client.
2. **Encryption at rest does not defend against same-origin JavaScript.** A
   vault protects a stolen disk. It does not protect against an XSS payload
   running in the page while the vault is unlocked.

## Decision

**Bring your own key, held in memory, for the session.** The default is that a
credential lives in a module-scoped variable in the tab that received it and is
gone when the tab closes. No storage, no persistence, no recovery.

**Optional local vault, only after explicit consent.** When the user chooses
"remember on this device":

- derive a key from a user passphrase with a reviewed KDF;
- generate a random data-encryption key;
- encrypt each credential with AES-GCM using a unique nonce and authenticated
  metadata;
- store only ciphertext, salt, KDF parameters, and wrapped key material;
- keep the unlocked key in memory only;
- auto-lock on inactivity, on visibility timeout, and on explicit lock.

**No shipped SourAI keys, ever.** Not in the bundle, not in a Pages variable,
not in a "public" test key. `src/vite-env.d.ts` documents every permitted
client variable and states that they are public.

**Redaction is enforced at the boundary, not by convention.**
`src/security/redaction.ts` masks credentials in strings and object graphs;
`SourError` redacts its message, user action, and details at construction and
keeps the original `cause` non-enumerable so it cannot be pulled into a
serialised event. Credentials never appear in prompts, persisted events, logs,
exports, runtime environments, preview frames, or audit records. The
`expectNoSecrets` canary assertion guards each of those surfaces in tests.

**The UI states the limitation.** Local encryption does not protect against
malicious JavaScript in the same origin. Because that is the real threat, the
mitigations are: a strict CSP, no runtime third-party scripts, pinned
dependencies and self-hosted assets, Trusted Types where practical, preview
content on an isolated origin, and no untrusted HTML rendered in the app origin.

**Data destination is shown before content is sent.** Provider and endpoint
origin, which files and chunks are included, which attachments, instructions,
skills, and memories, an estimated token count, and redaction status.

## Consequences

- The strongest available claim holds: with a local model, nothing leaves the
  device; with BYOK, content goes only to the provider the user chose.
- No shared key means no shared-key abuse, no billing surprise, and no key
  rotation incident.
- Cost: onboarding requires a key. Session-only default means re-entering it
  after a reload. That friction is the honest default; the vault is the opt-in
  escape hatch, offered with its limitation stated.
- Cost: XSS becomes the top-severity bug class for this product, because it is
  the one thing that defeats the whole model. Content-security work is not
  polish.
- Providers that block browser origins cannot be reached. That is a real gap
  with no client-only fix.

## Alternatives considered

**Ship a shared key behind a proxy.** Rejected — it is a backend, it receives
all content, and one leaked key affects every user.

**Persist keys in `localStorage` unencrypted.** Rejected. It survives a reload
and is readable by any script in the origin, giving the worst of both.

**WebAuthn/passkey-derived encryption instead of a passphrase.** Deferred.
Attractive, but the PRF extension is unevenly supported. Revisit when support
is broad enough to be a default rather than a second path to maintain.
