# Web application (`@workspace/web`)

## Role in the architecture

The browser application. It works with the signed-in identity's local replica: a
SurrealDB engine in a Web Worker on that identity's own IndexedDB database, and the
identity's private region as a CRDT document projected into it, kept in step with the
server through the gateway. Features are Angular-like modules under
`src/features/<feature>` with `domain`, `application` and `presentation` layers; reads and
writes are declared in `.surql` files next to their components and compiled by the
modeling stage.

- `src/composition/`: the composition root, the only code that imports adapters. Nothing
  is opened while nobody is signed in. The app starts only once the page's localStorage kept a
  value and gave it back (`siteStorage`): a browser that blocks site data stops at a message that
  says so, instead of forgetting who signed in and the device's id. A saved identity whose
  space does not open stops the start too, and the shell offers to sign out on this device
  (`SessionService.signOutUnopened()`): its keys are left to revoke and its databases deleted,
  so a database that will never open is no dead end. Signing up or in goes through the gateway
  (`gatewayAuth`, `POST /backend/auth/sign-up|sign-in` on the page's own origin; a 429 is
  `data:RATE_LIMITED`, and the sign-in page says to wait), naming the
  device: the browser's own id (`perch.device.id`, minted once and kept across sign-outs, and
  minted again when the stored value is not a device id of 1 to 64 characters) and a
  label read from the user agent (`deviceLabel`: "Chrome on Linux", "Safari on iPhone",
  "Browser on device" when it cannot tell, at most 60 characters); the sync channel names the
  same id in its hello and every organisation call sends it as `X-Perch-Device`. The
  identity, its keys and its memberships (`perch.session.memberships`, the current tenant in
  `perch.session.tenant`) are kept in local storage, and the identity's space opens
  (`openIdentitySpace`: database `indxdb://app-identity-<id>`, region `identity:<id>`,
  projector, write path), with a database of its own for each organisation the identity
  belongs to (`openTenantSpace`: `indxdb://app-identity-<id>-t_<key>`, region `tenant:<key>`;
  `TenantSpaces` keeps them in step with the memberships). The tabs of a browser open a database
  one at a time, under the Web Lock `perch-open:<database>` (`openOneAtATime`): two engines
  setting up the same new database at once conflict and one open fails. Reads and writes are routed by
  region (`RoutingShapeRunner`, `RoutingWritePath`): a shape over the tenant region's tables
  and a command into the tenant region go to the current organisation (the one selected on
  this browser, otherwise the first by key; none refuses with `no organisation is selected`),
  everything else to the identity's own database; a watch over the tenant region moves to the
  organisation that becomes current (or reports that none is). A reload opens the saved identity's space
  without the network. The session follows the memberships (`SessionOrganisations`): from the
  sign-in answer, from the leading tab's channel (the welcome and each `memberships` message)
  and from the other tabs through the storage; a new organisation's database opens, the
  database of one the identity left is deleted, and a leading tab syncs the regions on a new
  engine (`LeadingEngine`), except while a sign-out drains through the current one. Every organisation database the device holds for the identity is counted in
  `perch.session.tenant-databases` (`{ [identity]: keys }`, each identity's count apart, so
  another identity signing in on this browser leaves it as it is) before it opens, and stops
  being counted once deleted; the count outlives the keys, so whenever the space opens or follows
  the memberships, a counted database of an organisation the identity no longer belongs to is
  deleted even when it is not open (`deleteTenantLocal`): one kept across a sign-out that kept
  the databases, or one that failed to open. The memberships are saved before their databases
  are counted, and a tab deletes none whose organisation the memberships saved for the identity
  still hold, so a tab following an older list leaves alone a database another tab counted and
  opened for a newer one. A region space can replace its document (`replace`: `reset` drops the
  region's local copy, `reopen` opens it again from the database), refusing writes meanwhile;
  the projector then re-reads the new document. The leading tab's engine has the region space
  reset a region whose batch the gateway refused again after its rollback, and then loads it
  from the server; when a tab resets a region the other tabs reopen it (`RegionReloads`), on the
  `reset` hint or at their next touch of the region (a catch-up or a write that meets
  `data:REGION_STALE`). The routes that act for the signed-in device go through
  `bearerCalls(baseUrl, { token, device, renew })`: the access token as `Authorization: Bearer`
  and the device's id as `X-Perch-Device`, the token renewed once on a 401, refusals mapped to
  `data:` errors (the gateway's code as the message of `data:WRITE_REJECTED`, a 429 among them,
  which the organisation page words as "too many attempts"; any other status
  named without its body). `organisationsApi` calls the gateway's `/organisations` routes with
  it; the `ORGANISATIONS` port (`createOrganisations`) makes an organisation the identity
  creates its membership on the device at once, added to the newest list any tab kept. `devicesApi` is the `DEVICES` port over
  `GET /devices` (each device's session row id, label, times as dates, `revokedAt` when signed
  out, `current` for this device; the browser's own id is never sent back),
  `DELETE /devices/:id` and `POST /auth/sign-out-everywhere`. A token is renewed through the
  leading tab: it asks the gateway for a new pair over its open channel (`renew`), without
  connecting again (a channel that is down renews at the hello that brings it up); another tab
  asks the leader with the `renew` hint and waits for the new access key in storage (10 seconds at
  most). A renewal gives up at once when the leading tab's channel ended for good (keys refused,
  or the device signed out from another one), when the gateway's limits refused it, and when
  another tab removed the access key (it signed out): only a new key counts as renewed. One tab per browser leads the
  identity's sync through a Web Lock and runs the sync engine over the gateway's WebSocket
  (`/backend/sync`) for the private region and every organisation's, keeping every renewed pair of
  keys; the tabs hint each other over a BroadcastChannel, so each reads what the others wrote or
  imported. Signing out takes the lead, drains, has the gateway sign the device out, then forgets
  the keys and the memberships and deletes the identity's database and
  every organisation database the device holds for it, open or not, and the count of them; with
  changes it could not send it asks first. The identity is listed in
  `perch.session.leftover-identities` before its databases are deleted and taken off once they
  are gone (`SpaceDeletion`); a delete another tab still holds up after 5 seconds (it keeps the
  database open) goes on without the sign-out, whose tab then hears of it, and the sign-in page
  says the data leaves the device once the other tabs are closed. Each start deletes the
  databases of the identities still listed, but the one signed in, and opening an identity's
  database waits for a delete of it that the page runs. A sign-out the gateway did not confirm (offline, or
  giving unsent changes up, or kept by a frozen tab while offline) leaves the pair, whose grant
  still works, with the device it signed out, in `perch.session.pending-revoke`: one list for
  every account signed out on the browser, so another account's offline sign-out adds its pair
  after the ones waiting (at most 8: one more drops the oldest, which is reported; a single pair
  kept on its own reads as a list of one). The pairs are sent at once while the browser is
  online, else at the next start online, and in any case before the next sign-in, one after the
  other, to `POST /backend/auth/sign-out` (the pair in the body, its device in `X-Perch-Device`,
  no bearer token), and each is forgotten on its own answer: once revoked (204), refused as dead
  (401) or refused otherwise (any other 4xx, which the gateway will never take: reported); an
  unreachable, failing (5xx) or waiting-asking (429, `data:RATE_LIMITED`) gateway leaves that
  pair for the next try, a 429 without a report. A pair whose send or
  report throws is kept, the throw reported, and the pairs after it are sent all the same; a
  send that fails, even by a throw, never stops the next one. While a sign-out runs, no tab of the browser
  takes a write (a `sign-out` hint and the `perch.session.signing-out` mark, which lapses after a
  minute, hold them back), and every write a tab admits holds the Web Lock `perch-write:<id>` shared
  until it is durable; before it reads what is unsent and deletes, the sign-out takes that
  lock exclusive, waiting for writes admitted earlier, and keeps the database (as after
  refused keys) when it does not get it within 10 seconds (`WriteBarrier`). A change that still
  landed after the final drain keeps the database. A
  sign-out that asked the gateway in vain (no sign-out close) stops the engine's channel; when
  it leaves the person signed in, the leading tab syncs again on a new engine
  (`IdentitySpace.resumeSync()`), as a change of leader does, and so it does when the
  memberships changed while the sign-out drained. Keys
  the gateway refuses sign the device out locally, behind the same barrier and lock: the
  identity's database goes with them unless it holds changes not sent yet, in which case it
  stays (as after such a sign-out) and the sign-in page says to sign in again (as the same
  identity) to send them. A device signed out from another one (its channel closed with 4001,
  the transport's `revoked` ending) signs out the same way, and when its database goes the
  sign-in page says "You were signed out from another device."; the device keeps its id, and
  the dead pair is not left to revoke. A device that asked the gateway to sign every device out
  signs out the same way as soon as the gateway answered (`SessionPort.signingOutEverywhere()`,
  which names the asking session before the request goes), without waiting for a 4001 it may
  never hear (no Web Locks, or no WebSocket); whichever of the two comes second finds nothing
  left to do, and an answer that comes once the asking session has ended (another account, or
  the same one, signed in since) signs nobody out. A write that waited for the lock goes on only into the
  space it was admitted for, still open, and while no sign-out runs. A
  protocol the gateway refuses stops the sync and keeps everything. One account per browser: a
  tab follows another tab's sign-out by closing its space and another tab's sign-in by opening
  the space of the identity it saved (the sign-in page then moves to the profile, unless the
  sign-in is its own); a sign-up or sign-in that finds another account saved is refused with
  `data:OTHER_ACCOUNT` ("Sign it out first"), before it asks the gateway, or after it when
  another tab saved one meanwhile, whose new pair is then left to revoke. The container's runner and write
  path follow the current space and refuse while nobody is signed in. The command bus
  logs each command, validates its params and sets the execution context (actor, device
  and correlation ids). `<html data-boot-step>` shows the boot step; `data-sync-leader`
  and `data-sync-channel` show the tab's sync role and channel.
- `src/platform/`: `defineModule`, `ModuleScope`, `useService`, `useShape`, the router built
  from module routes (each page inside its module's scope; a protected page left open is
  checked again when the user signs out), the ports for the session (with the memberships
  and the current organisation), for commands, for organisations and for devices,
  notices the shell shows, the language state and the app-wide catalogs.
- `src/features/<feature>/`: one module per folder, each with its own README for its role,
  surface (routes, shapes, commands, providers) and commands; details live there, not here:
  - [app-shell](src/features/app-shell/README.md): the page frame, navigation and notices.
  - [user](src/features/user/README.md): accounts, sign-in and the identity's profile.
  - [organisation](src/features/organisation/README.md): memberships, members and the
    shared notes of the tenant region.
  - [device](src/features/device/README.md): My devices, signing one device or every one
    out.

## Key exports

`./seeding`: `openClient({ gatewayUrl })`, a device of the application in Bun or Node (the
composition root over an in-memory database, always leading its identity's sync, named
"Seed client" with an id minted into its memory storage) whose
`ensureAccount` signs an account up or in through the gateway, writes its profile through
commands and waits until the gateway acknowledged it, and whose `readAccount` signs in and
reads the profile the gateway sends; one device, it signs the account it is in out before it
enters another (one account per device), and stays in the last one. As the
signed-in account, `ensureOrganisation` creates an organisation (one that is already the
account's is found), `ensureMember` invites an existing account by email, and
`readOrganisation` signs in, makes the organisation current and reads its notes. Its HTTP calls
of the gateway go through `fetcher` (`openClient({ gatewayUrl, fetcher })`, the global `fetch`
by default), which a test talking to the gateway directly uses to name a client address in
`X-Forwarded-For`, as the front would. `openStand()` is the operator's connection to a stand as a system user, where seeded
accounts and the organisations they created are swept; it applies the directory schema with the
key the stand's gateway signs with (`signingKey`, required), so opening a stand never changes
that key. `checkProfileName` is the profile name rule the seed catalog is checked against. Entry point `src/main.tsx`; `src/modules.ts` lists the feature modules;
`src/test-utils.tsx` renders components with the application providers.

## Commands

- `bun run dev`: the build watcher, `vite build --watch --mode development`: rewrites `dist/`
  (source maps, no minifying) on every change. There is no dev server: the local stands'
  Caddy front serves `dist/`, so reload the page after a rebuild.
- `bun run build`: production build into `dist/`.
- `bun run test`: composition, platform and component tests.
- `bun run model` / `bun run model:check`: generate or check the models of `.surql` files.
- `bun run i18n:check`: translation keys against the catalogs.
- `bun run typecheck`, `bun run lint`.
