# Modeling (`@workspace/modeling`)

## Role in the architecture

The build-time modeling stage. It reads only `.surql` files (the shared schema and the
shapes and commands next to components) plus the folder layout, and generates typed
models, command operation plans, a page model and permission suites. It never reads
TypeScript or React code.

## Key exports

- `version`: the package version. The parser, inference and generators land with the
  modeling CLI (`model`, `model --check`).

## Commands

- `bun run test`: unit tests.
- `bun run typecheck`, `bun run lint`.
