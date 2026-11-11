# XkyHold

Browser-only PWA that backs up local folders, encrypted client-side, to the
user's own Google Drive. Web successor of BackMa. Full plan, architecture and
phases: `docs/PLAN.md`. Repository format: `docs/FORMAT.md` — the
engine must match it; change the spec first, then the code.

## Principles

- Target users are non-technical. If a feature needs explanation, it is
  probably wrong. Plain verbs, sentence case, no jargon.
- No server. Static site only; nothing but the user's browser and Google
  Drive ever sees data, and Drive only sees ciphertext.
- The backup engine is the product. Format changes need a written spec, a
  format version and round-trip tests before they ship.

## Stack

TypeScript, Vite, Svelte 5, Vitest. Engine code runs in a Web Worker
(`src/engine/worker.ts`) and must not depend on the UI; the page reaches it
only through `EngineClient` (`src/state/app.svelte.ts`). Errors cross that
boundary as a `kind` string (`src/engine/errors.ts`). Storage sits behind a `Destination` interface;
tests use an in-memory fake, never real Google Drive.

## Conventions

- Code, comments, commit messages, technical docs: English.
- UI strings: English source, pt-PT translation.
- Errors shown to users are actionable sentences; raw errors go to the log.
- Keep dependencies few and small.
