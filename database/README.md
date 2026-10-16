# Database schema (`@workspace/database`)

## Role in the architecture

The shared SurrealDB schema and its permission contract. `schema/*.surql` defines the
tables, access methods and functions; comment annotations above each table
(`-- @region`, `-- @replicate none`, `-- @id`, `-- @crdt`) tell the modeling stage
how the table replicates and which id prefix its keys use. The same schema is applied to
the local replica and to a server.

## Key exports

- `schema/`: the schema, applied in file name order.
- `tests/suites/*.toml`: SurrealKit permission suites; `tests/anonymous`: the
  unauthenticated-client check over raw HTTP.

## Commands

- `bun run test:db`: SurrealKit suites and the anonymous check against the stand at
  `SURREAL_URL` (default `http://127.0.0.1:8010`, the `surrealdb-e2e` app).
- `surreal db validate 'database/**/*.surql'`: syntax check without a database.
