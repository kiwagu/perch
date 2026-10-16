# Replica (`@workspace/replica`)

## Role in the architecture

The only package that depends on Loro. Replicated data lives in one CRDT document per
access region; the local SurrealDB is a materialized view of those documents. Commands
compiled from `.surql` run here as document operations in one commit, the projector
writes each touched record into the local database and announces the change, and every
local update is stored durably in the local database before it counts as persisted.

## Key exports

- `RegionDoc`: `inMemory(kind)`, `open(local, ref)` with persistence, `records()`,
  `recordJson(key)`, `flush()` (reports an update that could not be made durable; a failed
  update is retried before later ones), `persistedSeq()`, `compact()`, `close()`.
- `LoroWritePath`: implements the data layer's `WritePathPort`; a command succeeds only
  once its update is durable.
- `Projector`: `start()` projects current records and then every commit and import; `flush()`.
- `ReplicaSchema`: which fields are text, list or counter containers, references or datetimes.
- `ReplicaOp`, `recordKey`, `splitRecordKey`.

## Commands

- `bun run test`: unit tests of the write path and functional tests of the projector and
  persistence on an embedded in-memory database.
- `bun run typecheck`, `bun run lint`.
