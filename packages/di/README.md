# Dependency container (`@workspace/di`)

## Role in the architecture

Wires ports to adapters without decorators or reflection. A port and its token are
declared together in a `*.port.ts` file; the composition root binds factories, and
classes receive their dependencies through constructors.

## Key exports

- `token<T>(name)`: a typed token.
- `Container`: `singleton(token, factory)`, `get(token)`, `child()`.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
