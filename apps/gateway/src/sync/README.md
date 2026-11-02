# Device sync channel (module `sync`)

## Role in the architecture

The gateway's end of a device's sync channel: the WebSocket at `/sync`, from its hello to its
close, and the registry of open connections that membership changes and sign-outs reach. The
replicated regions themselves live in the region hub of `@workspace/replica/server`, which the
composition root builds; the session of a hello is read through the auth module's services. Its
connection is the folder `sync-connection/`, entered through its `index.ts`; the module itself
has no `index.ts` yet: it predates the index rule and is imported file by file.

Devices sync over a WebSocket at `/sync`: a hello carries the device's session token and its
device id at protocol 7; the gateway reads the session, checks the device, marks it seen and
welcomes it; once it is welcomed, the account's email and its profile's are compared, and the
profile's is written in the account's turn when they differ (`ProfileEmails.reconcile` of the
auth module), without holding the hello. The session is read through Better Auth
(`AuthSessions.read`) at every hello, so a session that ended or expired reads as none at once. A token that reads no live session closes
the socket with 4401 (`the session was not accepted`), and a session opened on another device
than the one the hello names with 4401 too (`no session for this device`): a session is bound to
the device it was opened on. A read the directory could not make closes the socket as a failed
server (1011), and the device comes back with the same token. Nothing is spent at a hello, so a
device may say it again on any socket. A device holds one live socket: the hello that registers
closes the device's older sockets with 1000 (`another connection of this device took over`,
`ConnectionRegistry.supersede`), which signs nothing out. A device is marked seen at its hello and
then at most every five minutes it talks, which extends its live session (`DeviceSessions.seen`);
a mark that fails is logged and changes nothing for the device. It is welcomed
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
A connection registers in the `ConnectionRegistry` (`connections.ts`) once its session is read;
when an identity's memberships change, each of its connections leaves the regions it
may no longer name at once, without waiting for the device's messages under way (one handled
from then on that names such a region closes the socket with 4403, and the hub sends it nothing
more there), and is sent a `memberships` message; it subscribes to a new organisation's region
itself. A change told while a connection's hello is under way applies right after its welcome.
Text the protocol refuses (4400, a hello of an earlier protocol or one that names no device
included), a token that reads no session of the device (4401), a region the device may not name
(4403) and a hello that did not come within 10 seconds (4408, after which the device connects
again) close the socket with the protocol's close codes; a session the directory could not read
closes it as a failed server (1011). A device's sign-out over its channel leaves its regions and
ends the session its hello came with, by its token (`AuthSessions.signOut`, as `POST
/auth/sign-out` does), then closes every socket of the device through the registry with 4000,
which means the session ended (`ConnectionRegistry.close(identity, device, 4000)`): that moves
the device's epoch, so a hello of the device that read the session before it ended is refused
its registration (4001). A session that cannot be ended is logged with the identity and the
error's code, nothing is closed through the registry, and the socket closes with 1011 (`revoke
failed`) instead; the device sends its sign-out again through the route. A device signed out from another device is closed with 4001 at once, whatever
it is doing, also while its hello is under way: the registry knows each connection's identity
and device (`ConnectionRegistry.close(identity, device, code)`, every device of the identity
when none is named), and each close moves the registry's revocation epoch, recorded against
what it names. A hello reads the epoch before it reads its session, and registers with it: a
close of the device or of its identity that lands meanwhile refuses the registration (4001), and
one before is seen by the read, since the routes end the session before they close the sockets.
A device whose session a change of the account's password ended (a reset link, which ends every
session of the account, or a change on another device, which ends every other one) is closed the
same way with 4002 (`CLOSE.passwordChanged`, `signed out because the password changed`), so it can
tell its person why; a hello whose registration such a close refuses, while it is under way, is
closed with 4001 as for any other close.
A new sign-up or sign-in of the device, once Better Auth accepted it, or the first verification
of an email opened on it, closes the identity's sockets on that device the same way, with 1000
(`another connection of this device took over`): its session ended the earlier one, and the
device connects again with the new token. A
connection that fails to close is reported and the others are closed all the same. No token
reaches its logs.

## Surface

- Route: `GET /sync`, upgraded to a WebSocket by `src/server.ts`.
- `SyncConnection` (`sync-connection/`): one device's socket: the hello, the welcome, subscribe,
  pull, push, probe and compact through the region hub, and sign-out over the channel; its index
  also exports `SocketLike`, `SyncConnectionDeps` and `SUPERSEDED` (1000, the close of a socket
  another connection or a new session of the device took over).
- `ConnectionRegistry` (`connections.ts`): the open connections by identity and device; it
  closes them, tells them their identity's memberships and takes regions from them.
- Messages: the replica's sync protocol (`@workspace/replica/protocol`), at protocol 7.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs (`connections.spec.ts`,
  `sync-connection/connection.spec.ts`, `sync-connection/device-regions.spec.ts`).
- `bun run test:db` (the smoke) and `bun run load` drive devices over the channel against a
  stand.
