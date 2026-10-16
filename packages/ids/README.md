# Entity ids (`@workspace/ids`)

## Role in the architecture

The single registry of entity id prefixes, shared by every layer. Each prefix is
declared here once and named over its table in the schema (`-- @id <prefix>`); the
modeling stage checks the two against each other. The validation depth is chosen by
the application's composition root, never by this package.

## Key exports

- `registry`: kinds `user` (`usr`) and `profile` (`prf`).
- `UserId`, `ProfileId`, `EntityKind`: branded id types.
- `userIdFactory`, `profileIdFactory`: `create()`, `is()`, `assert()`.
- `idSchemas`: Zod schemas per kind.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
