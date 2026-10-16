# Modeling (`@workspace/modeling`)

## Role in the architecture

The build-time modeling stage. It reads only `.surql` files (the shared schema and the
shapes and commands next to components) plus the folder layout, and generates typed
models, command operation plans, a page model and permission suites. It never reads
TypeScript or React code.

## Key exports

- `parseShapeFile`, `parseCommandsFile`: header annotations (`@params`, `@command`,
  `@allow`, `@deny`, `@tables`, `@server`) and the single statement under them.
- `parseShape`: the shape dialect as an AST (projections with fields, destructuring,
  aliases, graph traversals and inner queries; the source; the tail clauses).
- `tokenize`, `statementCount`: the shared SurrealQL tokenizer.
- `ModelingException`: thrown for a `.surql` file outside the dialect.

## Commands

- `bun run test`: unit tests.
- `bun run typecheck`, `bun run lint`.
