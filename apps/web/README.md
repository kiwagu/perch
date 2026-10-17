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
  is opened while nobody is signed in. Signing up or in goes through the gateway
  (`gatewayAuth`, `POST /backend/auth/sign-up|sign-in` on the page's own origin); the
  identity, its keys and its memberships (`perch.session.memberships`, the current tenant in
  `perch.session.tenant`) are kept in local storage, and the identity's space opens
  (`openIdentitySpace`: database `indxdb://app-identity-<id>`, region `identity:<id>`,
  projector, write path), with a database of its own for each organisation the identity
  belongs to (`openTenantSpace`: `indxdb://app-identity-<id>-t_<key>`, region `tenant:<key>`;
  `TenantSpaces` keeps them in step with the memberships). Reads and writes are routed by
  region (`RoutingShapeRunner`, `RoutingWritePath`): a shape over the tenant region's tables
  and a command into the tenant region go to the current organisation (the one selected on
  this browser, otherwise the first by key; none refuses with `no organisation is selected`),
  everything else to the identity's own database; a watch over the tenant region moves to the
  organisation that becomes current (or reports that none is). A reload opens the saved identity's space
  without the network. The session follows the memberships (`SessionOrganisations`): from the
  sign-in answer, from the leading tab's channel (the welcome and each `memberships` message)
  and from the other tabs through the storage; a new organisation's database opens, the
  database of one the identity left is deleted, and a leading tab syncs the regions on a new
  engine. Every organisation database the device holds for the identity is counted in
  `perch.session.tenant-databases` (`{ [identity]: keys }`, each identity's count apart, so
  another identity signing in on this browser leaves it as it is) before it opens, and stops
  being counted once deleted; the count outlives the keys, so whenever the space opens or follows
  the memberships, a counted database of an organisation the identity no longer belongs to is
  deleted even when it is not open (`deleteTenantLocal`): one kept across a sign-out that kept
  the databases, or one that failed to open. The memberships are saved before their databases
  are counted, and a tab deletes none whose organisation the memberships saved for the identity
  still hold, so a tab following an older list leaves alone a database another tab counted and
  opened for a newer one. `organisationsApi(baseUrl, { token, renew })` calls the gateway's `/organisations`
  routes with the access token, renewing it once on a 401 and mapping refusals to `data:`
  errors; the `ORGANISATIONS` port (`createOrganisations`) makes an organisation the identity
  creates its membership on the device at once. A token is renewed through the leading tab:
  it connects again and the gateway answers a token that no longer works with a new pair;
  another tab asks the leader with the `renew` hint and waits for the new access key in
  storage (10 seconds at most). One tab per browser leads the identity's sync through a Web
  Lock and runs the sync engine over the gateway's WebSocket (`/backend/sync`) for the private
  region and every organisation's, keeping every renewed pair of keys; the tabs hint each
  other over a BroadcastChannel, so each reads what the others wrote or imported. Signing out takes the lead, drains, has the gateway sign the device
  out, then forgets the keys and the memberships and deletes the identity's database and
  every organisation database the device holds for it, open or not, and the count of them; with
  changes it could not send it asks first. While a sign-out runs, no tab of the browser takes a write (a
  `sign-out` hint and the `perch.session.signing-out` mark, which lapses after a minute,
  hold them back), and every write a tab admits holds the Web Lock `perch-write:<id>` shared
  until it is durable; before it reads what is unsent and deletes, the sign-out takes that
  lock exclusive, waiting for writes admitted earlier, and keeps the database (as after
  refused keys) when it does not get it within 10 seconds. A change that still landed after
  the final drain keeps the database. A
  sign-out that asked the gateway in vain (no sign-out close) stops the engine's channel; when
  it leaves the person signed in, the leading tab syncs again on a new engine
  (`IdentitySpace.resumeSync()`), as a change of leader does. Keys
  the gateway refuses sign the device out locally, behind the same barrier and lock: the
  identity's database goes with them unless it holds changes not sent yet, in which case it
  stays (as after such a sign-out) and the sign-in page says to sign in again (as the same
  identity) to send them. A write that waited for the lock goes on only into the space it was
  admitted for, still open, and while no sign-out runs. A
  protocol the gateway refuses stops the sync and keeps everything. A tab follows another
  tab's sign-out by closing its space. The container's runner and write
  path follow the current space and refuse while nobody is signed in. The command bus
  logs each command, validates its params and sets the execution context (actor, device
  and correlation ids). `<html data-boot-step>` shows the boot step; `data-sync-leader`
  and `data-sync-channel` show the tab's sync role and channel.
- `src/platform/`: `defineModule`, `ModuleScope`, `useService`, `useShape`, the router built
  from module routes (each page inside its module's scope; a protected page left open is
  checked again when the user signs out), the ports for the session (with the memberships
  and the current organisation), for commands and for organisations,
  notices the shell shows, the language state and the app-wide catalogs.
- `src/features/app-shell/`: the page frame, painted before the database finishes opening,
  with the navigation (sign-in, or the profile and the organisation page). When the gateway
  refuses a change and this device undoes it, the session tells its rejection listeners and the
  shell raises a notice, so the change does not just vanish.
- `src/features/user/`: signing in or creating an account (`/sign-in`) and the signed-in
  user's profile (`/me`): name, email, a bio of at most 2000 characters saved with the name by
  one Save, and the chosen language, which follows the user across devices, and signing out,
  which asks before losing changes this device could not send. The sign-in page says so when
  the gateway refused the device's keys while it kept changes to send after the next sign-in.
- `src/features/organisation/`: the organisation page (`/org`). Without memberships it says so
  and offers to create an organisation (a key checked by the kernel's `isTenantKey`, a name of
  at most 80 characters); the creator becomes its administrator and the new organisation the
  current one. With memberships it shows the current organisation's name and the role there, a
  choice between organisations when there are several, and the organisation's notes (at most
  500 characters each), which every member reads, adds and edits in the tenant region; an
  administrator also sees the members, invites an existing account by email and removes a
  member. The page follows the memberships as they change, without a reload.

## Key exports

`./seeding`: `openClient({ gatewayUrl })`, a device of the application in Bun or Node (the
composition root over an in-memory database, always leading its identity's sync) whose
`ensureAccount` signs an account up or in through the gateway, writes its profile through
commands and waits until the gateway acknowledged it, and whose `readAccount` signs in and
reads the profile the gateway sends; it leaves each account without signing out. As the
signed-in account, `ensureOrganisation` creates an organisation (one that is already the
account's is found), `ensureMember` invites an existing account by email, and
`readOrganisation` signs in, makes the organisation current and reads its notes.
`openStand()` is the operator's connection to a stand as a system user, where seeded
accounts and the organisations they created are swept, and `checkProfileName` the profile name rule the seed catalog is
checked against. Entry point `src/main.tsx`; `src/modules.ts` lists the feature modules;
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
