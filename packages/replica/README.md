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
region from memory once nobody has subscribed for a while; each region's log lives in the
database the gateway names for it (an identity's private regions in one, each organisation's
tenant region in its own). On the device, a sync engine keeps
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
- `regionRefOf(id)`: the `RegionRef` a document id names, `identity:<idn_…>` (private) or
  `tenant:<key>` (tenant), undefined for any other; `tenantKeyOf(ref)`, the organisation key of
  a tenant region; `privateRegionId(identity)`; `identityRegions(identity, memberships)`, the
  identity's private region and the region of each of its organisations.
- `@workspace/replica/protocol`: the client-to-gateway sync contract as Zod schemas
  (`clientMessage`, `serverMessage`, `PROTOCOL_VERSION` (3), `CLOSE`, `MAX_PUSH_UPDATES`,
  `rejectReason`, `compactionOutcome`) with `encodeMessage` / `decodeMessage`, which carry
  Loro bytes as base64 and return a `Result` with a `ProtocolError` for refused text; the
  `welcome` carries the regions the device may name with their heads and the identity's
  memberships, and a `memberships` message tells each later change of them. And the
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
  history, a table outside the region, `invalid-record` for a record that is not a map or has
  a field of a shape its schema does not allow, `forbidden-action` for a
  create, update or delete that `ValidateBatchInput.ability` does not allow on the record, and
  `foreign-owner` for a record that breaks the owner rule: in a private region an identity
  reference other than the pushing identity, `ValidateBatchInput.actor`; in a tenant region a new record whose
  member reference is not the pushing member, or an edit that changes the member a record
  references). The ability is judged on the record as it is, the one being updated or deleted
  as it was before the batch and a new one as the batch writes it; a table that declares no
  abilities refuses every client write. A record's field shapes are checked first: a text,
  list or counter field holds the mergeable container of its kind, every other field a plain
  value, whatever the content. A record the batch leaves as it was is then no change and
  is neither judged nor written, which is what lets a device undo a refused change: the batch
  that undoes it carries the refused change and its inverse. Such a batch still reaches the
  document, so a plain field it set and set back wins a later last-writer-wins conflict with a
  concurrent edit, as any accepted write does. Bytes Loro throws on are refused
  as malformed, never thrown. The check of the roots reads the operations of the
  batch, not its net effect: a write outside the `records` map that a later operation of the
  same batch undid is refused too, as the operations would still be stored and replicated.
  The mergeable containers of a record's fields appear as roots in the operations and are
  exempt from that refusal when their path leads into the `records` map or when they have no
  path (their record is gone, or the field they belong to is not set).
  `RegionDatabases` is the port the hub keeps regions through: `acquire(region)` resolves to a
  `RegionDatabase` (`local`, `release()`); `singleDatabase(local)` keeps every region in one
  database. `RegionHub` (`RegionHubOptions`: `databases`, schema, `Clock`, idle time, log length
  that asks for a compaction, `onError`) holds a region's database from its load until it
  unloads (or the hub closes): `subscribe(region, actor, subscriber, vv)` answers with the
  updates after `vv` or a full snapshot, and checks the device's batches against `actor`
  (`Actor`: its identity id and its `Ability`); `push(region, subscriber, batch, updates)` answers
  with an ack (asking for a compaction once the log outgrows its limit) or a reject
  (`foreign-owner` for a record of another region, `forbidden-action` for a write the actor's
  ability refuses) and sends the batch to the other subscribers, `pull`, `compact` (stores its own document's snapshot at the proposed row),
  `heads(regions)` (an unloaded region's from its own database, one query per database; 0
  for a region without a log or one `regionRefOf` does not know), `unsubscribe`,
  `loadedRegions()`, `close()`; a `Subscriber` receives `ServerMessage`s through `send`.
- `@workspace/replica/sync`: `createSyncEngine(options)` (`batchRows`, the most outbox rows one
  push carries, 256 by default) returns a `SyncEngine` (`start`,
  `stop`, `visibility`, `localWrite` to drain now, `settled(timeoutMs)` once the outbox is
  empty, every local update is durable (one whose append fails is reported once and never
  settles) and every region has its first answer on the current connection, `signOut()` that
  drains and has the gateway sign the device out (`signed-out` only on the sign-out close; any
  other close after it asked, or none within 10 seconds, stops the transport and answers
  `offline`), or answers `offline` while anything stays unsent, rows of a region that stopped
  syncing and updates that failed to persist included; it never rejects; `channelStopped()`
  tells that such a sign-out stopped the channel, after which only a new engine syncs; `reconnect()`
  asks the transport to connect again at once, so the gateway welcomes the device anew with fresh keys).
  Its parts:
  `WebSocketTransport` (hello with the stored keys, up after the welcome, reconnect after
  `RECONNECT_DELAYS_MS`, also when no welcome came within `WELCOME_TIMEOUT_MS` of the socket
  opening, and on `reconnect()`, which gives a welcomed connection up and connects again from
  the first delay, and leaves one not welcomed yet to the hello it says; renewed keys to `onTokens`, the memberships of the welcome and of each
  `memberships` message to `onMemberships`, `onEnded` with an `EndReason` when the keys
  (`unauthorized`) or the protocol (`protocol`) are refused or the device is signed out; the
  engine stops syncing on a refused protocol and reports it) behind the `SyncTransport` port;
  `RegionSync` per region (subscribe, import and pull, push with acknowledgement or rollback,
  compaction proposals; before each push, and on every full pass, `catchUpLocal()` imports the
  rows other tabs appended, and nothing is pushed while that fails, so an ack never moves the
  cursor past rows the document lacks; a push or pull answered with an error or unanswered for 30 seconds is
  given up for now and sent again, and
  an unanswered one, like a probe unanswered for 30 seconds, has the transport reconnect; an
  import that fails pulls at once and on every full pass until an answer imports in full; only
  the ack of a first push moves the cursor; the push after a rollback carries every outbox row
  from the refused ones through their inverse, rows other tabs queued between included, whatever
  `batchRows` says, as one update when they are more than `MAX_PUSH_UPDATES`, so a refused batch
  never goes out again without its undo);
  `createOutboxDrain(target)` (one batch at a time, requests during a round fold into one more);
  `createCadence(clock, pass)` with `CADENCE_MS` (probes and full passes).
  `leadership(locks, lockName(identity))` makes one tab per browser the sync leader through a
  Web Lock (`isLeader`, `onChange`, `takeOver` steals the lock, `stop`; undefined without Web
  Locks, such a browser does not sync); `writeLockName(identity)` names the lock over writes
  into the identity's database (held `shared` by each write, `exclusive` by a sign-out before
  it deletes; `LockManagerLike.request` takes `mode`); `syncHints(channel)` sends `journal`, `visible`, `kick`,
  `settled`, `sign-out` and `renew` (a tab asks the leader to renew the keys) hints between tabs over a `BroadcastChannel` and ignores anything
  else on it.
- `@workspace/replica/testing`: `manualClock(start)`, a `ManualClock` that runs scheduled
  tasks only when a test calls `advance(ms)`, and counts them with `pending()`;
  `gatewayStub({ local, schema, clock, memberships })`, a `GatewayStub` with a region hub on the
  given database and, per device, a `StubTransport` that behaves like the gateway's connection
  without a network (welcomed with the identity's private region, where it is the owner, and,
  for each of the `memberships`, none by default, the organisation's region, where its batches
  are checked with the abilities of the membership's role), can go
  offline and come back, and counts its `reconnects()`;
  `dropNextFanOutTo`, `rejectEverything`, `swallowNextPush`, `swallowNextProbe`,
  `refuseNextPull`, `renewAtNextHello(tokens)` (hands the next device to connect a renewed pair
  before its welcome), `keepOpenOnSignOut` (takes the sign-out in, handles nothing more and leaves
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

- `bun run test`: unit tests of the write path, the schema, the protocol, the region
  references, the batch validator,
  the transport, the cadence, the outbox drain, the leader, the hints and the manual clock, and
  functional tests of the projector, persistence, the server log, the region hub, region sync
  and the sync engine (devices syncing through the gateway stub) on embedded in-memory databases.
- `bun run measure`: the write path on this machine (1000 create commands, 1000 renames of one
  record, projecting 1000 records into an embedded database), printed as JSON.
- `bun run measure:validation`: what checking a pushed batch costs the server, as a table: p50
  and p95 of `validateBatch` for 200 batches of 1 and of 20 changes on regions of 10, 100 and
  1000 profile records, the time of `doc.fork()` alone and the region's snapshot size.
- `bun run typecheck`, `bun run lint`.
