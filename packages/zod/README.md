# Zod (`@workspace/zod`)

## Role in the architecture

The single Zod instance of the workspace. Its error map turns every issue without an
explicit message into a translation key, `validation.<issue code>`, which the
presentation layer translates. Other packages import Zod from here.

## Key exports

- `z`: Zod with the shared error map applied.
- `validationKey(code)`: the translation key for an issue code.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
