# Replica (`@workspace/replica`)

## Role in the architecture

The only package that depends on Loro. Replicated data lives in one CRDT document per
access region; the local SurrealDB is a materialized view of those documents. Commands
compiled from `.surql` run here as document operations in one commit, the projector
writes each touched record into the local database and announces the change, and every
local update is stored durably in the local database before it counts as persisted. The
local database numbers each region's update log, so tabs sharing it never reuse a number (a
number is unique per region; a write that lost its number to another tab's engine is sent
again at once under the next one);
updates from a server are stored before they are imported, and a cursor records how far
the region has been pulled. On the server the same tables hold each region's authoritative
log: a pushed batch is first applied to a fork of the region's document and checked there,
then accepted together with its projection in one transaction, under a number without
gaps, and a compaction replaces rows with the server's own snapshot of the region at that
row, once a device proposed one of the same version (the proposed bytes are never stored). A hub holds
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
  `outbox(limit)` of `OutboxRow`s (`id`, `seq`, `bytes`), `acknowledge(rows)`, which drops
  exactly those rows by id, `importLocal(rows)`, which imports outbox rows into the document
  only (the leader does so with each batch it pushes), and `catchUpLocal()`, which imports
  what other tabs appended to the update log, one row at a time so a projector sees it as
  an import.
- `LoroWritePath`: implements the data layer's `WritePathPort`; a command succeeds only
  once its update is durable.
- `Projector`: `start()` projects current records, deletes those the region projected
  earlier but no longer holds (a deletion that failed before a reload), then follows
  every commit and import; `flush()` retries failed records and reports those still failing.
- `@workspace/replica/protocol`: the client-to-gateway sync contract as Zod schemas
  (`clientMessage`, `serverMessage`, `PROTOCOL_VERSION`, `CLOSE`, `MAX_PUSH_UPDATES`,
  `rejectReason`, `compactionOutcome`) with `encodeMessage` / `decodeMessage`, which carry
  Loro bytes as base64 and return a `Result` with a `ProtocolError` for refused text; and the
  membership contract the gateway and devices share: `membership` (an organisation's `id`,
  `key` and `name` with the identity's role there) and `tenantRole` (`member` or `admin`), with
  their types `Membership` and `TenantRole`.
- `@workspace/replica/server`: `RegionLog.load(local, region)` resolves to the log and the
  region's document built from its snapshot and later rows; `accept(plan)` writes an
  `AcceptPlan` (its `ProjectedRow` upserts, `DeletedRow` deletes, update bytes and version)
  and its log row in one transaction and resolves to the batch's number, refusing a
  projection that breaks a schema rule, or that writes a record of another region (one that
  exists without this region's projection marker, or a deletion of one), with
  `data:WRITE_REJECTED` (the latter's message starts with `ownership`); `compact(covers,
  proposal, snapshotOf)` resolves to a `CompactionOutcome`: a proposal whose version matches the
  version stored with row `covers` is accepted, and the log stores the snapshot `snapshotOf`
  exports for that version, never the proposal; `head()`, `covers()`. `validateBatch(input)` applies a
  pushed batch to a fork of the authoritative document, which it never modifies, and returns
  the fork with the `AcceptPlan` of the records the batch changed, or a `BatchRejection` with
  its `RejectReason` (bytes that do not decode or write outside the `records` map, missing
  history, a table outside the region, a record that is not a map, a private record
  referencing another identity).
  `RegionHub` (`RegionHubOptions`: database, schema, `Clock`, idle time, log length that asks
  for a compaction, `onError`): `subscribe(region, owner, subscriber, vv)` answers with the
  updates after `vv` or a full snapshot, `push(region, subscriber, batch, updates)` answers
  with an ack (asking for a compaction once the log outgrows its limit) or a reject
  (`foreign-owner` for a record of another region) and sends the batch to the other
  subscribers, `pull`, `compact` (stores its own document's snapshot at the proposed row),
  `heads(regions)`, `unsubscribe`, `loadedRegions()`,
  `close()`; a `Subscriber` receives `ServerMessage`s through `send`.
- `@workspace/replica/sync`: `createSyncEngine(options)` returns a `SyncEngine` (`start`,
  `stop`, `visibility`, `localWrite` to drain now, `settled(timeoutMs)` once the outbox is
  empty, every local update is durable (one whose append fails is reported once and never
  settles) and every region has its first answer on the current connection, `signOut()` that
  drains and has the gateway sign the device out (`signed-out` only on the sign-out close; any
  other close after it asked, or none within 10 seconds, stops the transport and answers
  `offline`), or answers `offline` while anything stays unsent, rows of a region that stopped
  syncing and updates that failed to persist included; it never rejects; `channelStopped()`
  tells that such a sign-out stopped the channel, after which only a new engine syncs).
  Its parts:
  `WebSocketTransport` (hello with the stored keys, up after the welcome, reconnect after
  `RECONNECT_DELAYS_MS`, also when no welcome came within `WELCOME_TIMEOUT_MS` of the socket
  opening, and on `reconnect()`, which gives the connection up and connects again from the
  first delay; renewed keys to `onTokens`, `onEnded` with an `EndReason` when the keys
  (`unauthorized`) or the protocol (`protocol`) are refused or the device is signed out; the
  engine stops syncing on a refused protocol and reports it) behind the `SyncTransport` port;
  `RegionSync` per region (subscribe, import and pull, push with acknowledgement or rollback,
  compaction proposals; before each push, and on every full pass, `catchUpLocal()` imports the
  rows other tabs appended, and nothing is pushed while that fails, so an ack never moves the
  cursor past rows the document lacks; a push or pull answered with an error or unanswered for 30 seconds is
  given up for now and sent again, and
  an unanswered one, like a probe unanswered for 30 seconds, has the transport reconnect; an
  import that fails pulls at once and on every full pass until an answer imports in full; only
  the ack of a first push moves the cursor);
  `createOutboxDrain(target)` (one batch at a time, requests during a round fold into one more);
  `createCadence(clock, pass)` with `CADENCE_MS` (probes and full passes).
  `leadership(locks, lockName(identity))` makes one tab per browser the sync leader through a
  Web Lock (`isLeader`, `onChange`, `takeOver` steals the lock, `stop`; undefined without Web
  Locks, such a browser does not sync); `writeLockName(identity)` names the lock over writes
  into the identity's database (held `shared` by each write, `exclusive` by a sign-out before
  it deletes; `LockManagerLike.request` takes `mode`); `syncHints(channel)` sends `journal`, `visible`, `kick`,
  `settled` and `sign-out` hints between tabs over a `BroadcastChannel` and ignores anything
  else on it.
- `@workspace/replica/testing`: `manualClock(start)`, a `ManualClock` that runs scheduled
  tasks only when a test calls `advance(ms)`, and counts them with `pending()`;
  `gatewayStub({ local, schema, clock })`, a `GatewayStub` with a region hub on the given
  database and, per device, a `StubTransport` that behaves like the gateway's connection
  without a network, can go offline and come back, and counts its `reconnects()`;
  `dropNextFanOutTo`, `rejectEverything`, `swallowNextPush`, `swallowNextProbe`,
  `refuseNextPull`, `keepOpenOnSignOut` (takes the sign-out in, handles nothing more and leaves
  the channel open), `failNextSignOut` (closes as a gateway that could not
  revoke the grant), `endWith(reason)` (the gateway refuses the keys or the
  protocol, or signs the devices out), `rejections`, `signOuts`, `compactions` and `failures`
  steer and observe it in tests. `FakeLocks` behaves like `navigator.locks` (per name,
  `shared` and `exclusive` modes granted in request order, `steal`, abort signals; `waiting(name,
  mode)` tells a test that a request waits) and
  `FakeHintChannel` like a `BroadcastChannel` (synchronous), for the tabs of a browser.
- `Clock` (`now()`, `schedule(ms, run)` returning a cancel function) and `systemClock`.
- `toColumns(schema, table, record)`: a record's values as the document holds them, turned
  into column values (record ids, dates), shared by the projector and the server.
- `ReplicaSchema` of `ReplicaTable`s: per replicated table, the region whose documents hold
  its records and which fields are text, list or counter containers, references or
  datetimes; `fieldOf(schema, table, field)`, `tablesOf(schema, region)`.
- `ReplicaOp`, `recordKey`, `splitRecordKey`.

## Commands

- `bun run test`: unit tests of the write path, the schema, the protocol, the batch validator,
  the transport, the cadence, the outbox drain, the leader, the hints and the manual clock, and
  functional tests of the projector, persistence, the server log, the region hub, region sync
  and the sync engine (devices syncing through the gateway stub) on embedded in-memory databases.
- `bun run measure`: the write path on this machine (1000 create commands, 1000 renames of one
  record, projecting 1000 records into an embedded database), printed as JSON.
- `bun run measure:validation`: what checking a pushed batch costs the server, as a table: p50
  and p95 of `validateBatch` for 200 batches of 1 and of 20 changes on regions of 10, 100 and
  1000 profile records, the time of `doc.fork()` alone and the region's snapshot size.
- `bun run typecheck`, `bun run lint`.
