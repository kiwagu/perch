# Data layer (`@workspace/data`)

## Role in the architecture

The only package that depends on the SurrealDB driver. It opens the local database
(applying the schema only when it changed since the last opening, so saved sessions
stay valid across reloads), runs shapes and commands compiled from `.surql` files,
announces table changes so watched shapes rerun, and handles accounts: sign-up,
sign-in, and sessions resumed from a saved access token or through a refresh key that
is replaced on every use. Above this package ids are entity id strings and times are
`Date`s; driver record ids and datetimes do not leave it.

## Key exports

- Ports with tokens: `ShapeRunnerPort` / `SHAPE_RUNNER`, `WritePathPort` / `WRITE_PATH`,
  `AuthPort` / `AUTH`, `LocalDbPort` / `LOCAL_DB`.
- Adapters: `openLocalDb`, `ShapeRunner`, `runCommand`, `SurrealWritePath`, `createAuth`.
- `runAsOperator`: runs one SurrealQL text as a system user without applying the schema
  (a stand's namespaces, databases and system users), failing at once when the server
  does not answer.
- `Shape`, `Command` (with an optional Standard Schema `schema` for its params),
  `TableChange`, `publishChange`, `onChange`, `DataError`.
- `./engines/node`: embedded engines for Bun and Node; `./engines/remote`: engines for a
  SurrealDB server, opened as a system user through `openLocalDb({ credentials })` (a root
  user, or a namespace user when the credentials name the namespace), and `wsRpcUrl`, the
  server's WebSocket RPC endpoint for any of its `http(s)://` or `ws(s)://` addresses.
- `./schema-files`: `readSchema()`, the shared schema as one text (Bun and Node).
- `./bun-plugin-surql`: the `.surql` loader for Bun, imported first by CLIs.
- Value helpers: `recordId`, `recordRef`, `recordTableOf`, `toDriverParams`, `fromDriverValue`.
- `./testing`: `openTestDb()` (in-memory database with the shared schema), `readSchema()`,
  `FakeShapeRunner` (a runner without a database for component tests),
  `interceptQueries()` (holds or fails queries, as a slow or broken database would; its
  queries keep `retry()`).
- `./engines/wasm`: browser engines in a Web Worker (Vite builds only).
- `./vite-plugin-surql`: `surqlPlugin()` loads plain `.surql` files as text; `./surql` types such imports.

## Commands

- `bun run test`: unit tests and functional tests on an embedded in-memory database.
- `bun run typecheck`, `bun run lint`.
