# Device sync channel (module `sync`)

## Role in the architecture

The gateway's end of a device's sync channel: the WebSocket at `/sync`, from its hello to its
close, and the registry of open connections that membership changes and sign-outs reach. The
replicated regions themselves live in the region hub of `@workspace/replica/server`, which the
composition root builds; the keys of a hello go through the auth module's services. Its
connection is the folder `sync-connection/`, entered through its `index.ts`; the module itself
has no `index.ts` yet: it predates the index rule and is imported file by file.

Devices sync over a WebSocket at
`/sync`: a device says hello with its keys and its device id at protocol 6 (the
pair is renewed with the refresh key when the access token no longer works, and the new pair is
sent first).
The hello is bound to the device's row: a renewal moves the row from the grant it spent to the
new one, only while the row holds the spent grant and is not signed out; any other hello reads
the row. The access token the hello is accepted with (as it came, renewed or parked) must belong
to the row's current session: the database verified it, and the gateway reads the second it was
issued in from its payload. A device without a row, a renewal whose row holds another grant, and
a token issued before the row's session started (one of an earlier session: the device was
signed out, then signed in again) or naming no such second are closed with 4401 (`no session for
this device`), a device signed out with 4001, and a pair renewed for any of them is revoked at
once. What this does not catch: a live access token presented under another live device of the
same identity, whose session started before the token was issued, binds to that device until
the token expires (at most 15 minutes); the list of devices never gives their ids away. A
welcomed device may ask for a new pair over its open channel (`renew`, no payload: the
connection holds the pair it renews, `sync-connection/channel-renewal.ts`): the same limits, refresh exchange and
row move as a hello's renewal, the new pair sent as `tokens` and held from then on; a renewal the
limits refuse is answered with an `error` of code `rate-limited` and the channel kept; refused
keys close with 4401, a device signed out with 4001 (its new pair revoked at once); a socket that
closed before the pair could go leaves it parked for the device's next hello. A device holds one
live socket: the hello that registers closes the device's older sockets with 1000 (`another
connection of this device took over`, `ConnectionRegistry.supersede`), which signs nothing out,
and the device's key operations (a hello from its key check to its registration, and a `renew`)
run one at a time across its sockets (`PendingPairs.exclusively`). So a hello finds parked the
pair a renewal under way could not deliver, whatever its access token; a `renew` that waited for
a newer hello of the device finds its socket closed and spends nothing; and a `renew` whose key a
hello of the device spent takes the pair that hello parked, looked up first, so no renewal is
tried or counted. A `tokens` message the socket drops
(`send` answers 0) or throws on is parked the same way and the socket closed as a failed server
(1011), at hello and over the channel. A pair sent to an older socket the device gave up, before a
newer hello of it came, is lost with that socket, and the device signs in again. A bound
device is marked seen at its hello and then at most every five minutes it talks, and is welcomed
with its identity's private region, the region `tenant:<key>` of each organisation the identity
belongs to and those memberships, the only regions it may name (an organisation whose database
cannot be read is left out of the welcome and logged, its membership kept: the device syncs only
the regions its welcome names, so it leaves that one alone until its next hello, though the
connection would still serve it; the private region failing fails the hello,
`sync-connection/welcome-heads.ts`), and subscribes, pulls, pushes,
probes and compacts there through the region hub, the server's copy of the replicated regions, which
answers it and sends each accepted batch to the region's other devices. The hub keeps a private
region in the directory and a tenant region in its organisation's database, and names them so
(`src/tenants/region-databases.ts`, `databaseOf`: `directory`, `t_<key>`), and checks each batch against the device's identity: a
note names its own member as its author, and nobody changes the author of a note. Each
subscription carries the device's ability, built from its membership's role and the replica
schema (`defineAbilityFor`, the owner's everything in its private region): a member edits and
deletes only its own notes, an admin any, and the hub rejects any other write as
`forbidden-action`. The hub keeps the ability a subscription was made with, so a change of
role applies to a device's subscriptions from its next subscribe or hello. The hub also refuses
a batch that brings changes under a Loro peer another identity's batch was accepted under in the
region (`foreign-peer`), so no member can write as another member's device and stop it.
A connection registers in the `ConnectionRegistry` (`connections.ts`) once the keys are
accepted; when an identity's memberships change, each of its connections leaves the regions it
may no longer name at once, without waiting for the device's messages under way (one handled
from then on that names such a region closes the socket with 4403, and the hub sends it nothing
more there), and is sent a `memberships` message; it subscribes to a new organisation's region
itself. A change told while a connection's hello is under way applies right after its welcome.
Text the protocol refuses (4400, a hello of an older protocol or one that names no device
included), keys the database refused (4401), a region the device may not name (4403) and a hello
that did not come within 10 seconds (4408, after which the device connects again) close the
socket with the protocol's close codes; keys the database could not judge (it could not be
reached) close it as a failed server (1011), and the device comes back with the same keys, as it
does after a hello closed with 1013 because the limits refused its renewal (see `src/limits/README.md`). A
device's sign-out leaves its regions, marks its row signed out, forgets the pairs parked for it
and revokes its refresh grant through the database as the namespace user, as `POST
/auth/sign-out` does, then closes the socket with 4000, which means the grant is revoked; a row
that cannot be marked or a grant that cannot be revoked closes the socket with 1011 (`revoke
failed`) instead, and the device sends its sign-out again through the route. A device signed
out from another device is closed with 4001 at once, whatever
it is doing, also while its hello is under way: the registry knows each connection's identity
and device (`ConnectionRegistry.close(identity, device, code)`, every device of the identity
when none is named), and each close moves a revocation epoch of the device or of the identity.
A hello reads the epoch once its keys are accepted, before it reads the row, and registers with
it: a sign-out that lands meanwhile refuses the registration (4001), one before it is seen by
the read. A connection that fails to close is reported and the others are closed all the same.
A renewed pair the socket closed before it could take is parked, for 60 seconds after the last
hello that held it (one that takes it and parks it again, below, starts them over), under
the device and a SHA-256 digest of the refresh key the renewal spent (the key itself is not
kept) and logged at warn as `renewed pair not delivered: parked for the next hello of the
device`: the device's next hello with that spent key is handed the parked pair once (`tokens`,
before its welcome) and welcomed, looked up before its keys are checked, so no renewal is tried
or counted; a pair is never handed to another device, and signing the device out or signing in
on it again forgets it; a hello whose keys the database could not judge leaves it parked, and
one that could not judge the parked pair, or whose renewal of it the limits refused, parks it
again. Keys, tokens and grant ids never reach its logs.

## Surface

- Route: `GET /sync`, upgraded to a WebSocket by `src/server.ts`.
- `SyncConnection` (`sync-connection/`): one device's socket: the hello and its renewal, the
  welcome, subscribe, pull, push, probe and compact through the region hub, `renew` and
  sign-out over the channel; its index also exports `SocketLike`, `SyncConnectionDeps` and
  `TRY_AGAIN_LATER` (the 1013 close of a hello whose renewal a limit refused).
- `ConnectionRegistry` (`connections.ts`): the open connections by identity and device; it
  closes them, tells them their identity's memberships and takes regions from them.
- Messages: the replica's sync protocol (`@workspace/replica/protocol`), at protocol 6.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs (`connections.spec.ts`,
  `sync-connection/connection.spec.ts`, `sync-connection/device-regions.spec.ts`).
- `bun run test:db` (the smoke) and `bun run load` drive devices over the channel against a
  stand.
