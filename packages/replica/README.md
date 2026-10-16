# Replica (`@workspace/replica`)

## Role in the architecture

The only package that depends on Loro. Replicated data lives in one CRDT document per
access region; the local SurrealDB is a materialized view of those documents. Commands
compiled from `.surql` run here as document operations in one commit, the projector
writes each touched record into the local database and announces the change, and every
local update is stored durably in the local database before it counts as persisted. The
local database numbers each region's update log, so tabs sharing it never reuse a number;
updates from a server are stored before they are imported, and a cursor records how far
the region has been pulled. On the server the same tables hold each region's authoritative
log: a batch is accepted together with its projection in one transaction, under a number
without gaps, and a compaction replaces rows with a snapshot only when it matches them.

## Key exports

- `RegionDoc`: `inMemory(kind)`, `open(local, ref)` with persistence, `records()`,
  `recordMap(key)`, `recordJson(key)`, `flush()` (reports an update that could not be made
  durable; a failed update is retried before later ones), `persistedSeq()`, `compact()`,
  `close()`. Sync state: `importRemote(bytes, head)` resolves to an `ImportOutcome` and moves
  the cursor only when nothing is left pending, `pulled()`, `advanceCursor(head)`,
  `outbox(limit)` of `OutboxRow`s, `acknowledge(seq)`, and `catchUpLocal()`, which imports
  what other tabs appended to the update log.
- `LoroWritePath`: implements the data layer's `WritePathPort`; a command succeeds only
  once its update is durable.
- `Projector`: `start()` projects current records, deletes those the region projected
  earlier but no longer holds (a deletion that failed before a reload), then follows
  every commit and import; `flush()` retries failed records and reports those still failing.
- `@workspace/replica/protocol`: the client-to-gateway sync contract as Zod schemas
  (`clientMessage`, `serverMessage`, `PROTOCOL_VERSION`, `CLOSE`, `MAX_PUSH_UPDATES`,
  `rejectReason`, `compactionOutcome`) with `encodeMessage` / `decodeMessage`, which carry
  Loro bytes as base64 and return a `Result` with a `ProtocolError` for refused text.
- `@workspace/replica/server`: `RegionLog.load(local, region)` resolves to the log and the
  region's document built from its snapshot and later rows; `accept(plan)` writes an
  `AcceptPlan` (its `ProjectedRow` upserts, `DeletedRow` deletes, update bytes and version)
  and its log row in one transaction and resolves to the batch's number, refusing a
  projection that breaks a schema rule with `data:WRITE_REJECTED`; `compact(covers, snapshot)`
  resolves to a `CompactionOutcome`; `head()`, `covers()`.
- `toColumns(schema, table, record)`: a record's values as the document holds them, turned
  into column values (record ids, dates), shared by the projector and the server.
- `ReplicaSchema` of `ReplicaTable`s: per replicated table, the region whose documents hold
  its records and which fields are text, list or counter containers, references or
  datetimes; `fieldOf(schema, table, field)`, `tablesOf(schema, region)`.
- `ReplicaOp`, `recordKey`, `splitRecordKey`.

## Commands

- `bun run test`: unit tests of the write path and functional tests of the projector,
  persistence and the server log on an embedded in-memory database.
- `bun run typecheck`, `bun run lint`.
