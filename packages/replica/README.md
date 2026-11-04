# Replica (`@workspace/replica`)

## Role in the architecture

The only package that depends on Loro. Replicated data lives in one CRDT document per
access region; the local SurrealDB is a materialized view of those documents. Commands
compiled from `.surql` run here as document operations in one commit, the projector
writes each touched record into the local database and announces the change, and every
local update is stored durably in the local database before it counts as persisted. The
local database numbers each region's update log, so tabs sharing it never reuse a number (a
number is unique per region; a write that lost its number to another tab's engine is sent
again at once under the next one); a reset drops a region's local copy and moves it to a new
generation, and a document of an earlier one can no longer write to the log or read from it
(a document reads the generation before the copy it opens, so a reset meanwhile leaves it stale);
updates from a server are stored before they are imported, and a cursor records how far
the region has been pulled. On the server the same tables hold each region's authoritative
log: a pushed batch is first applied to a fork of the region's document and checked there,
then accepted together with its projection and the binding of each Loro peer it writes as
to the pushing identity in one transaction, under a number without gaps (a batch of another
identity under a bound peer is refused, so no member can write as another member's device),
and a compaction replaces rows with the server's own snapshot of the region at that
row, once a device proposed one of the same version (the proposed bytes are never stored). The
server writes a region's records too: a change of its own to one record, made as a Loro peer
reserved for the server and bound to no identity, takes the same way as a device's batch. A hub holds
the authoritative document of every region a device subscribes to, handles one region's
work at a time, sends each accepted batch to the region's other subscribers and drops a
region from memory once nobody has subscribed for a while, or at once when it is retired; each
region's log lives in the database the gateway names for it (an identity's private regions in
one, each organisation's tenant region in its own). On the device, a sync engine keeps
each region in step with the gateway over one WebSocket: it pushes the outbox a batch at a
time, imports what the gateway sends, pulls what is missing, rolls a rejected batch back with
an inverse commit, and runs passes on a cadence that follows the tab and the channel.

## Key exports

- `RegionDoc`: `inMemory(kind)`, `open(local, ref)` with persistence, `records()`,
  `recordMap(key)`, `recordJson(key)`, `flush()` (reports an update that could not be made
  durable; a failed update is retried before later ones), `persistedSeq()`, `compact()`
  (saves a snapshot of the document and drops the log rows it covers; the outbox stays),
  `compactIfLong(limit)` (compacts once the log holds more than `limit` rows past the snapshot,
  and leaves it for later while imported updates wait for their history), `close()`. A document
  opens from the snapshot and the rows after it. Sync state: `importRemote(bytes, head)` resolves to an `ImportOutcome` and moves
  the cursor only when nothing is left pending, `pulled()`, `advanceCursor(head)`,
  `outbox(limit)` of `OutboxRow`s (`id`, `seq`, `bytes`), `acknowledge(rows)`, which drops
  exactly those rows by id, `importLocal(rows)`, which imports outbox rows into the document
  only (the leader does so with each batch it pushes), and `catchUpLocal()`, which imports
  what other tabs appended to the update log, one row at a time so a projector sees it as
  an import; when a compaction dropped rows it had not read, the snapshot comes first. `stale()` tells whether another document of the region reset it since this one
  opened (an in-memory document never is); every write and catch-up of such a document fails
  `data:REGION_STALE`.
- `replaceRegionDoc(local, current, how)` (`RegionReplacement`: `reset` or `reopen`): the
  document that takes `current`'s place: `reset` drops the region's local copy (snapshot, update
  log, outbox, cursor; every change not sent yet) and opens it empty, `reopen` opens again what
  the database holds after another document reset it; `current` is closed once its successor
  is open, and a reset the database refuses changes nothing.
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
  (`clientMessage`, `serverMessage`, `PROTOCOL_VERSION` (8), `CLOSE`, `MAX_PUSH_UPDATES`,
  `rejectReason`, whose `foreign-peer` names a batch under a Loro peer another identity
  writes as, `compactionOutcome`) with `encodeMessage` / `decodeMessage`, which carry
  Loro bytes as base64 and return a `Result` with a `ProtocolError` for refused text; a
  `hello` carries the device's session token (`token`, the raw token its sign-in answered) and
  names the device it comes from (`device`, the browser's own id of 1 to 64 characters,
  `deviceId`, required: a hello without it breaks the protocol, 4400); the `welcome` carries
  the regions the device may name with their heads and the identity's memberships, and a
  `memberships` message tells each later change of them. `CLOSE` names the gateway's close
  codes: `protocol` 4400, `unauthorized` 4401 (a token that holds no live session, or a session
  opened on another device than the one the hello names), `forbidden` 4403, `timeout` 4408,
  `signedOut` 4000 (the device's own sign-out), `revoked` 4001 (the device's session was
  signed out from another device, alone or with every device of its identity, also while its
  hello is under way) and `passwordChanged` 4002 (the device's session ended because the
  account's password changed: through a reset link, every device; on another device, every
  device but that one). And the membership contract the gateway
  and devices share: `membership` (an organisation's `id`, `key` and `name` with the
  identity's role there) and `tenantRole` (`member` or `admin`), with their types `Membership`
  and `TenantRole`.
- `@workspace/replica/server`: `RegionLog.load(local, region)` resolves to the log and the
  region's document built from its snapshot and later rows; `accept(plan, writer)` writes an
  `AcceptPlan` (its `ProjectedRow` upserts, `DeletedRow` deletes, update bytes and version)
  and its log row in one transaction and resolves to the batch's number, binding each Loro
  peer the `BatchWriter` names (the peers whose changes the batch brings) to its pushing
  identity in the same transaction, refusing a projection that breaks a schema rule, a record
  of another region (one that exists without this region's projection marker, or a deletion of
  one), or a batch under `SERVER_PEER` or under a peer bound to another identity, with
  `data:WRITE_REJECTED` (the second's message starts with `ownership`, the third's with `peer`);
  `accept(plan, 'server')` takes the server's own change and binds no peer; `compact(covers,
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
  references, and `readonly-field` for an update of an existing record that changes a field the
  schema marks `readonly` (judged after the owner rule; a record the batch creates sets such
  fields freely, and a change followed by its inverse in one batch is no change)). The ability
  is judged on the record as it is, the one being updated or deleted as it was before the
  batch and a new one as the batch writes it; a table that declares no abilities refuses every
  client write. A record's field shapes are checked first: a text,
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
  `RegionDatabases` is the port the hub keeps regions through: `databaseOf(region)` names the
  database that keeps a region (the hub reads the heads of the regions of one name together, and
  assumes no layout of its own), `acquire(region)` resolves to a `RegionDatabase` (`local`,
  `release()`); `singleDatabase(local)` keeps every region in one database. `RegionHub` (`RegionHubOptions`: `databases`, schema, `Clock`, idle time, log length
  that asks for a compaction, `onError`) holds a region's database from its load until it
  unloads or is retired (or the hub closes): `subscribe(region, actor, subscriber, vv)` answers with the
  updates after `vv` or a full snapshot, and checks the device's batches against `actor`
  (`Actor`: its identity id and its `Ability`); a subscription after `close()` is answered with
  an internal error before anything else, and a private region other than the actor's own with
  `forbidden-region`, neither holding the region; `push(region, subscriber, batch, updates)` answers
  with an ack (asking for a compaction once the log outgrows its limit) or a reject
  (`foreign-owner` for a record of another region, `forbidden-action` for a write the actor's
  ability refuses, `foreign-peer` for a batch under the server's Loro peer or one another
  identity writes as in the region; every region document a device opens writes as a random peer
  of its own, so honest devices never share one) and sends the batch to the other subscribers,
  `writeRecord(region, write)` (below), `pull`, `compact` (stores its own document's snapshot at the proposed row),
  `heads(regions)` (an unloaded region's from its own database, one query per database; 0
  for a region without a log or one `regionRefOf` does not know), `unsubscribe`,
  `retire(region)` (below), `loadedRegions()`, `close()` (it waits for the retires under way); a
  `Subscriber` receives `ServerMessage`s through `send`. `retire(region)` lets a region go at
  once, for a region whose database is removed: the work asked of it before runs first and
  settles as it would have, then its database is released and a scheduled unload is cancelled. A
  subscription or a write asked from then on, also while the retire waits, holds the region
  afresh and loads it from its database once the retire settled, so a region made again under the
  same id never gets the retired document, and `heads` reads its head from the database. The
  devices still subscribed go with the region, told nothing (the caller ends their connections
  first), and a push, pull or compaction they send afterwards is answered as not subscribed. A
  region the hub does not hold is left as it is; a release that throws is a `data:WRITE_FAILED`.
  `writeRecord(region, write)` makes a change of the server's own to one record of a region and
  resolves to its number in the log. A `RecordWrite` names the record's `table` and `id` and the
  fields to `set`, each to a `FieldValue`: a plain field's value, a `Date` for a datetime, the id
  of the record a reference names, or a text field's whole text. It is checked against the
  replica schema first: the table belongs to the region's kind, the region holds the record,
  each field is one of the table's own (a name every object inherits is none), a list or a
  counter is refused (only its own operations change it), a date names a time, and in a private
  region an identity reference names the region's owner. The fields are then set on a fork of
  the region's document that writes as `SERVER_PEER`, and the
  change is logged with its projection, imported and sent to every subscriber as `updates`, in
  the region's queue like a device's batch and never between the steps of one; a device that
  was offline gets it at its next pull. A region the hub does not hold is loaded for the write
  and unloads after the idle time when nobody subscribes. A write the schema or the projection
  refuses, or with a value the document cannot hold, is `data:WRITE_REJECTED` (a value of the
  result, never a throw) and logs nothing, a write that changes nothing resolves to
  the current head without a log row, and once the hub is closed a write is `data:WRITE_FAILED`.
  What a server write means for the record: a plain field is last-writer-wins, as a device's
  write is (Loro orders two concurrent writes of a field by Lamport time, then by peer, and
  `SERVER_PEER` is the largest peer Loro allows, so the server's value wins a tie); a text field
  is replaced through its mergeable text and merges with concurrent edits. A device's change
  of a field the schema marks `readonly` is refused (`readonly-field`), so the server's value
  stands. The device undoes the refused change and keeps every change of other peers it already
  holds: when the server's write reached the device before the undo, the undo keeps the server's
  value and is accepted; an undo that restores the old value against the server's new one is
  refused again, and the device reloads the region from the server. A device's
  later batches touching the record are checked as before and pass: the server binds no peer
  and keeps the region's owner rule. On a device the change is an ordinary update, stored in the
  local log, imported and projected, so compaction and snapshots treat it like any other row on
  both sides. The server's peer continues the counters of the hub's document, so one hub writes
  a region at a time.
- `@workspace/replica/sync`: `createSyncEngine(options)` (`batchRows`, the most outbox rows one
  push carries, 256 by default; `localCompactionRows`, how many rows past its snapshot a region's
  local log holds before a full pass compacts it, 200 by default as on the server;
  `replaceRegion(region, how)`, the app's document that takes a
  region's place, below; `online()`, whether the platform says the device has a network) returns
  a `SyncEngine` (`start`,
  `stop`, `visibility`, `localWrite` to drain now, `settled(timeoutMs)` once the outbox is
  empty, every local update is durable (one whose append fails is reported once and never
  settles) and every region has its first answer on the current connection (a region that
  stopped or that the welcome left out counts as settled), `caughtUp(region, timeoutMs)` once
  that one region has caught up with the gateway on the current connection: the welcome named
  it, it still syncs, its subscription was answered, and every update since, the answer
  included, was imported in full (none waits to be imported, none failed or left updates
  waiting for their history, no pull is out); a reconnect or a reload of the region starts it
  over, and it rejects after `timeoutMs`, never resolving for a region that stopped, one the
  welcome left out or one the engine does not hold, `signOut()` that
  drains and has the gateway sign the device out (`signed-out` only on the sign-out close; any
  other close after it asked, or none within 10 seconds, stops the transport and answers
  `offline`; it answers `offline` at once while the channel is down and `online()` says there is
  no network), or answers `offline` while anything stays unsent, rows of a region that stopped
  syncing and updates that failed to persist included; it never rejects; `channelStopped()`
  tells that such a sign-out stopped the channel, after which only a new engine syncs).
  Its parts:
  `WebSocketTransport` (hello with the session token its `credentials` give, `{ token }`, and
  the `device` it is given, ending as `unauthorized` when they give none; up after the
  welcome, reconnect after
  `RECONNECT_DELAYS_MS`, also when no welcome came within `WELCOME_TIMEOUT_MS` of the socket
  opening, and on `reconnect()`, which gives a welcomed connection up and connects again from
  the first delay, and leaves one not welcomed yet to the hello it says; the memberships of the
  welcome and of each `memberships` message to `onMemberships`, `onEnded` with an `EndReason`
  when the token (`unauthorized`) or the protocol (`protocol`) is refused, the device is signed out
  (`signed-out`), signed out from another device (`revoked`, 4001) or by a change of the
  account's password (`password-changed`, 4002), none followed by a
  reconnect; `endingOf(code)` tells which close code ends the channel with which reason; the
  engine stops syncing on a refused protocol and reports it, and stops its passes without a
  report on `revoked` and `password-changed`) behind the `SyncTransport` port;
  `RegionSync` per region (subscribe, import and pull, push with acknowledgement or rollback,
  compaction proposals; only the regions the welcome names are subscribed, probed and pushed on
  that connection: one the identity left while offline is left alone, counts as settled, and
  makes a sign-out answer `offline` while it holds unsent rows; a retired region sends nothing
  more, not even from work under way; before each push, and on every full pass, `catchUpLocal()` imports the
  rows other tabs appended, and nothing is pushed while that fails, so an ack never moves the
  cursor past rows the document lacks; a push or pull answered with an error or unanswered for 30 seconds is
  given up for now and sent again, and
  an unanswered one, like a probe unanswered for 30 seconds, has the transport reconnect; an
  import that fails subscribes again at once, on every full pass and on a reconnect, until the
  answer to a subscription imports in full: nothing tells a pull's answer from the updates the
  gateway sends meanwhile, so a pull never counts as that recovery; the first subscription on a
  connection goes with the document's version and the first update after it is its answer, and
  any later one there (a recovery, a region replaced, a subscription sent again) goes without a
  version, the snapshot that only such a subscription gets being its answer; only
  the ack of a first push moves the cursor; the push after a rollback carries every outbox row
  from the refused ones through their inverse, rows other tabs queued between included, whatever
  `batchRows` says, as one update when they are more than `MAX_PUSH_UPDATES`, so a refused batch
  never goes out again without its undo). A batch refused again after its rollback no longer
  stops the region: the engine (`EngineRegions`) asks the app for a new document of the region
  (`replaceRegion`, `reset`: `replaceRegionDoc` drops the local copy with every change not sent
  yet), subscribes it without a version, so the gateway answers with a full snapshot, and
  reports `data:REGION_RELOADED` once; the one `data:PUSH_REJECTED` of the first refusal stays
  the only rejection. A region another tab reset (`data:REGION_STALE`) is opened again
  (`reopen`); a replacement that fails stops the region as before (`data:SYNC_STOPPED`), and
  `settled` waits for a replacement under way;
  `createOutboxDrain(target)` (one batch at a time, requests during a round fold into one more);
  `createCadence(clock, pass)` with `CADENCE_MS` (probes and full passes).
  `leadership(locks, lockName(identity))` makes one tab per browser the sync leader through a
  Web Lock (`isLeader`, `onChange`, `takeOver` steals the lock, `stop`; undefined without Web
  Locks, such a browser does not sync); `writeLockName(identity)` names the lock over writes
  into the identity's database (held `shared` by each write, `exclusive` by a sign-out before
  it deletes; `LockManagerLike.request` takes `mode`); `syncHints(channel)` sends `journal`, `visible`, `kick`,
  `settled`, `sign-out` and `reset` (a tab reset a region; the others open it again
  from the database) hints between tabs over a `BroadcastChannel` and ignores anything
  else on it. `invert(doc, rows)` applies to a region's document the undo of outbox rows the
  server refused, as a rollback does.
- `@workspace/replica/testing`: `manualClock(start)`, a `ManualClock` that runs scheduled
  tasks only when a test calls `advance(ms)`, and counts them with `pending()`;
  `gatewayStub({ local, schema, clock, memberships })`, a `GatewayStub` with a region hub on the
  given database and, per device (`transport(identity, device)`, the device `STUB_DEVICE`,
  `test-device`, by default), a `StubTransport` that behaves like the gateway's connection
  without a network (welcomed with the identity's private region, where it is the owner, and,
  for each of the `memberships`, none by default, the organisation's region, where its batches
  are checked with the abilities of the membership's role), can go
  offline and come back, and counts its `reconnects()`;
  `dropNextFanOutTo`, `rejectEverything`, `swallowNextPush`, `swallowNextProbe`,
  `refuseNextPull`, `keepOpenOnSignOut` (takes the sign-out in, handles nothing more and leaves
  the channel open), `failNextSignOut` (closes as a gateway that could not end the session,
  1011), `endWith(reason)` (the gateway refuses the token or the protocol, or signs the devices
  out), `closeChannels(identity, device, code)` (closes the
  channels of one device of the identity, or of all of them when `device` is undefined, as the
  gateway closes a device signed out from another one: a code that ends a channel ends it with
  its reason, any other drops it and the device connects again), `rejections`, `signOuts`,
  `compactions` and `failures`
  steer and observe it in tests. `FakeLocks` behaves like `navigator.locks` (per name,
  `shared` and `exclusive` modes granted in request order, `steal`, abort signals; `waiting(name,
  mode)` tells a test that a request waits) and
  `FakeHintChannel` like a `BroadcastChannel` (synchronous), for the tabs of a browser.
  `interceptRegionResets(local, before)` wraps a device database so each region reset first
  goes through `before`, which may throw (the reset fails) or wait (the reset is held).
- `Clock` (`now()`, `schedule(ms, run)` returning a cancel function) and `systemClock`.
- `toColumns(schema, table, record)`: a record's values as the document holds them, turned
  into column values (record ids, dates), shared by the projector and the server.
- `ReplicaSchema` of `ReplicaTable`s: per replicated table, the region whose documents hold
  its records and every field with its kind: a text, list or counter container, a reference, a
  datetime or a plain value, and optionally `readonly: true`, which a device sets only when it
  creates the record; `fieldOf(schema, table, field)`, `readonlyFieldsOf(schema, table)`,
  `tablesOf(schema, region)`.
- `ReplicaOp`, `recordKey`, `splitRecordKey`.

## Commands

- `bun run test`: unit tests of the write path, the schema, the protocol, the region
  references, the batch validator, the batch writer, the server's record writes,
  the transport, the cadence, the outbox drain, the leader, the hints and the manual clock, and
  functional tests of the projector, persistence, the server log, the batch intake, the region
  hub, region sync
  and the sync engine (devices syncing through the gateway stub) on embedded in-memory databases.
- `bun run measure`: the write path on this machine (1000 create commands, 1000 renames of one
  record, projecting 1000 records into an embedded database) and the time to open a region
  whose local log holds 1000 rows, then once it is compacted, printed as JSON.
- `bun run measure:validation`: what checking a pushed batch costs the server, as a table: p50
  and p95 of `validateBatch` for 200 batches of 1 and of 20 changes on regions of 10, 100 and
  1000 profile records, the time of `doc.fork()` alone and the region's snapshot size.
- `bun run typecheck`, `bun run lint`.
