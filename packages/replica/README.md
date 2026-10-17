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
log: a pushed batch is first applied to a fork of the region's document and checked there,
then accepted together with its projection in one transaction, under a number without
gaps, and a compaction replaces rows with a snapshot only when it matches them. A hub holds
the authoritative document of every region a device subscribes to, handles one region's
work at a time, sends each accepted batch to the region's other subscribers and drops a
region from memory once nobody has subscribed for a while. On the device, a sync engine keeps
each region in step with the gateway over one WebSocket: it pushes the outbox a batch at a
time, imports what the gateway sends, pulls what is missing, rolls a rejected batch back with
an inverse commit, and runs passes on a cadence that follows the tab and the channel.

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
  resolves to a `CompactionOutcome`; `head()`, `covers()`. `validateBatch(input)` applies a
  pushed batch to a fork of the authoritative document, which it never modifies, and returns
  the fork with the `AcceptPlan` of the records the batch changed, or a `BatchRejection` with
  its `RejectReason` (bytes that do not decode or write outside the `records` map, missing
  history, a table outside the region, a record that is not a map, a private record
  referencing another identity).
  `RegionHub` (`RegionHubOptions`: database, schema, `Clock`, idle time, log length that asks
  for a compaction, `onError`): `subscribe(region, owner, subscriber, vv)` answers with the
  updates after `vv` or a full snapshot, `push(region, subscriber, batch, updates)` answers
  with an ack (asking for a compaction once the log outgrows its limit) or a reject and sends
  the batch to the other subscribers, `pull`, `compact`, `heads(regions)`, `unsubscribe`,
  `loadedRegions()`, `close()`; a `Subscriber` receives `ServerMessage`s through `send`.
- `@workspace/replica/sync`: `createSyncEngine(options)` returns a `SyncEngine` (`start`,
  `stop`, `visibility`, `localWrite` to drain now, `settled(timeoutMs)` once the outbox is
  empty and every region has its first answer on the current connection, `signOut()` that
  drains and has the gateway sign the device out, or answers `offline`). Its parts:
  `WebSocketTransport` (hello with the stored keys, up after the welcome, reconnect after
  `RECONNECT_DELAYS_MS`, renewed keys to `onTokens`, `onEnded` when the keys are refused or the
  device is signed out) behind the `SyncTransport` port; `RegionSync` per region (subscribe,
  import and pull, push with acknowledgement or rollback, compaction proposals);
  `createOutboxDrain(target)` (one batch at a time, requests during a round fold into one more);
  `createCadence(clock, pass)` with `CADENCE_MS` (probes and full passes).
- `@workspace/replica/testing`: `manualClock(start)`, a `ManualClock` that runs scheduled
  tasks only when a test calls `advance(ms)`, and counts them with `pending()`;
  `gatewayStub({ local, schema, clock })`, a `GatewayStub` with a region hub on the given
  database and, per device, a `StubTransport` that behaves like the gateway's connection without
  a network and can go offline and come back; `dropNextFanOutTo`, `rejectEverything`,
  `rejections`, `compactions` and `failures` steer and observe it in tests.
- `Clock` (`now()`, `schedule(ms, run)` returning a cancel function) and `systemClock`.
- `toColumns(schema, table, record)`: a record's values as the document holds them, turned
  into column values (record ids, dates), shared by the projector and the server.
- `ReplicaSchema` of `ReplicaTable`s: per replicated table, the region whose documents hold
  its records and which fields are text, list or counter containers, references or
  datetimes; `fieldOf(schema, table, field)`, `tablesOf(schema, region)`.
- `ReplicaOp`, `recordKey`, `splitRecordKey`.

## Commands

- `bun run test`: unit tests of the write path, the transport, the cadence and the outbox
  drain, and functional tests of the projector, persistence, the server log, the region hub and
  the sync engine (devices syncing through the gateway stub) on embedded in-memory databases.
- `bun run typecheck`, `bun run lint`.
