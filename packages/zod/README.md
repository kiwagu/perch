# Zod (`@workspace/zod`)

## Role in the architecture

The single Zod instance of the workspace. Its error map turns every issue without an
explicit message into a translation key, `validation.<issue code>`, which the
presentation layer translates. Other packages import Zod from here.

## Key exports

- `z`: Zod with the shared error map applied.
- `validationKey(code)`: the translation key for an issue code.
- The `browser` condition (`src/browser.ts`), which a browser build resolves: the same instance
  with Zod's compiled parser turned off (`jitless`), so Zod never evaluates a string as code and
  a Content-Security-Policy without `'unsafe-eval'` sees no probe for it. Every schema takes `z`
  from this package, so the setting is in place before the first one is defined; a server
  (the gateway) resolves the default entry and keeps the compiled parser.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
