# ESLint config (`@workspace/eslint-config`)

## Role in the architecture

The narrow ESLint layer next to Biome. Biome formats, orders imports and runs the base
lint; this config adds only what Biome cannot check: blank lines between statements,
hexagonal layer boundaries, type-aware promise rules, the type-aware rules that stop
an untyped (`any`) value from spreading or a deprecated API from being used, the must-use-Result rule, immutability
rules for domain and application code, one class per file everywhere, and one exported
function or class per file in domain and application code. It never formats tokens. Tests
(`*.spec.*`) may cross layers: like the composition root, they wire real adapters and
generated models.

Type-aware rules run on TypeScript 6 (the `lint` catalog), because TypeScript 7 does not
ship the JavaScript compiler API that typescript-eslint needs.

## Key exports

- default / `base`: the flat config array used by the root `eslint.config.js`.
- `ignores`: the shared ignore block.
- `workspace/must-use-result`: reports a discarded neverthrow `Result` or `ResultAsync`.
- `workspace/one-unit-per-file`: in domain and application code, reports a second exported
  function or class in a file; types, constants, schemas and private helpers are free.

## Commands

- `bun run test`: rule tests and fixture-based config tests.
- `bun run lint`.
