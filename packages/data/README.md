# Data layer (`@workspace/data`)

## Role in the architecture

The only package that depends on the SurrealDB driver. It opens the local database
(applying the schema only when its text changed since the last opening), runs shapes and
commands compiled from `.surql` files, announces table changes so watched shapes rerun, and
gives the gateway's accounts their database through SurrealDB's Better Auth adapter. The
account types (`AuthUser`, `SignUpInput`, `SignInInput`) are shared by the gateway and the web
application. Above this package ids are entity id strings and times are `Date`s; driver record
ids and datetimes do not leave it.

## Key exports

- Ports with tokens: `ShapeRunnerPort` / `SHAPE_RUNNER`, `WritePathPort` / `WRITE_PATH`,
  `LocalDbPort` / `LOCAL_DB`.
- Account types: `AuthUser` (an identity's id and email), `SignUpInput` (email, password, the
  account's own name and its language), `SignInInput` (email, password, and `signOutOldest`, which
  confirms a sign-in past the account's limit of devices; unconfirmed, such a sign-in fails as
  `data:DEVICE_LIMIT`).
- Adapters: `openLocalDb`, `applySchema`, `ShapeRunner`, `runCommand`, `SurrealWritePath`.
  `applySchema(local, schema)` applies a schema to an open database and remembers it, as
  `openLocalDb` does when the schema changed, failing with `data:QUERY_FAILED`. A
  `LocalDb` closes once however often `close()` is called; `destroy()` closes it and deletes
  what it stored (the browser's IndexedDB database of an `indxdb://` address; an in-memory
  database is gone once closed). `deleteLocalDb(url)` deletes what a database that is not open
  stored, the same way, without opening it.
- `runAsOperator`: runs one SurrealQL text as a system user without applying the schema
  (a stand's namespaces, databases and system users), failing at once when the server
  does not answer.
- `Shape`, `Command` (with an optional Standard Schema `schema` for its params),
  `TableChange`, `publishChange`, `onChange`, `DataError`.
- `./engines/node`: `nodeEngines()`, embedded engines for Bun and Node; `./engines/remote`:
  `remoteEngines()` for a SurrealDB server, opened as a system user through
  `openLocalDb({ credentials })` (a root user, or a namespace user when the credentials name
  the namespace), and `wsRpcUrl`, the server's WebSocket RPC endpoint for any of its
  `http(s)://` or `ws(s)://` addresses; `./engines/wasm`: `wasmEngines()`, browser engines in a
  Web Worker (Vite builds only); `./engines/wasm-module`: `wasmEngineModule`, the address of
  the WASM module that worker loads, for a page that fetches it ahead of the engine.
- `./schema-files`: `readSchema(database)`, the schema of the `directory` or the `tenant`
  database as one text: the common files, then the database's own (Bun and Node).
- Organisation names: `tenantDatabase(key)` (`t_<key>`) and `tenantRegionId(key)`
  (`tenant:<key>`), for a key the kernel's `isTenantKey` accepts.
- `./surql-names` (also from the root): `surqlComponentFile`, `surqlExportName`, `camelCase`,
  `pascalCase`, the names that bind a `.surql` file to its generated module, shared by the
  modeling stage and the bundler plugins.
- `./bun-plugin-surql`: the `.surql` loader for Bun, imported first by CLIs.
- `./better-auth-adapter`: `surrealAuthAdapter(local)`, Better Auth's database on an open
  connection through SurrealDB's adapter (Bun and Node; the adapter is patched under `patches/`
  to use the connection's driver classes, to give each transaction a handle of its own, so
  concurrent requests never run inside each other's transactions, and to leave a failed join's
  error to its caller instead of printing it whole, the query's bindings with it, to stderr).
- Value helpers: `recordId`, `recordRef`, `recordTableOf`, `toDriverParams`, `fromDriverValue`.
- `./testing`: `openTestDb({ schema?, namespace?, database? })` (in-memory database with the
  directory schema by default), `readSchema(database)`,
  `FakeShapeRunner` (a runner without a database for component tests),
  `interceptQueries()` (holds or fails queries, as a slow or broken database would; its
  queries keep `retry()`).
- `./vite-plugin-surql`: `surqlPlugin()` loads plain `.surql` files as text; `./surql` types such imports.

## Commands

- `bun run test`: unit tests and functional tests on an embedded in-memory database.
- `bun run typecheck`, `bun run lint`.
