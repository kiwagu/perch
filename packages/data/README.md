# Data layer (`@workspace/data`)

## Role in the architecture

The only package that depends on the SurrealDB driver. It opens the local database,
runs shapes and commands compiled from `.surql` files, announces table changes so
watched shapes rerun, and handles accounts. Above this package ids are entity id
strings and times are `Date`s; driver record ids and datetimes do not leave it.

## Key exports

- Ports with tokens: `ShapeRunnerPort` / `SHAPE_RUNNER`, `WritePathPort` / `WRITE_PATH`,
  `AuthPort` / `AUTH`, `LocalDbPort` / `LOCAL_DB`.
- Adapters: `openLocalDb`, `ShapeRunner`, `runCommand`, `SurrealWritePath`, `createAuth`.
- `Shape`, `Command`, `TableChange`, `publishChange`, `onChange`, `DataError`.
- `./engines/node`: embedded engines for Bun and Node.
- Value helpers: `recordId`, `recordRef`, `recordTableOf`, `toDriverParams`, `fromDriverValue`.
- `./testing`: `openTestDb()` (in-memory database with the shared schema), `readSchema()`,
  `FakeShapeRunner` (a runner without a database for component tests).
- `./engines/wasm`: browser engines in a Web Worker (Vite builds only).
- `./vite-plugin-surql`: `surqlPlugin()` loads plain `.surql` files as text; `./surql` types such imports.

## Commands

- `bun run test`: unit tests and functional tests on an embedded in-memory database.
- `bun run typecheck`, `bun run lint`.
