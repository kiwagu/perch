# Modeling (`@workspace/modeling`)

## Role in the architecture

The build-time modeling stage. It reads only `.surql` files (the shared schema and the
shapes and commands next to components) plus the folder layout, and generates typed
models, command operation plans, a page model and permission suites. It never reads
TypeScript or React code.

## Key exports

- CLI `model --root <dir> [--schema <dir>] [--suites <dir>] [--check]` (`main`, `runModel`):
  validates every `.surql` with `surreal db validate`, applies the schema to an embedded
  database and reads its structure, cross-checks `-- @id` prefixes against the entity id
  registry, then writes per component `<name>.model.gen.ts` and `<name>.<role>.surql.d.ts`,
  plus `pages.model.json`, `replica.schema.gen.ts` and `generated-<module>.toml` suites.
  `--check` writes nothing and fails on missing, different or stale output.
- CLI `lint-surql [dir ...]` (root `bun run lint:surql`, part of `lint` and `check`): fails on a
  string or template literal in TypeScript that holds a SurrealQL statement; reads the syntax
  tree with oxc-parser. The modeling sources are exempt: their tests feed SurrealQL to the parsers.
- `findSurqlLiterals`: the same check for one file.
- `parseShapeFile`, `parseCommandsFile`, `parseShape`, `tokenize`: the dialect parsers.
- `loadSchemaModel`, `parseStructure`: the schema model with its annotations
  (`@region`, `@replicate none`, `@id`, `@crdt`) and their problems.
- `inferResultType`, `tablesOf`, `compileCommand`, `checkIdRegistry`, `collect`, the emitters.

## Commands

- `bun run test`: unit tests, and CLI tests on a temporary module (needs the `surreal` CLI).
- `bun run typecheck`, `bun run lint`.
