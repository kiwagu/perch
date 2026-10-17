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
  identity and its keys are kept in local storage, and the identity's space opens
  (`openIdentitySpace`: database `indxdb://app-identity-<id>`, region `identity:<id>`,
  projector, write path). A reload opens the saved identity's space without the network.
  One tab per browser leads the identity's sync through a Web Lock and runs the sync
  engine over the gateway's WebSocket (`/backend/sync`), keeping every renewed pair of
  keys; the tabs hint each other over a BroadcastChannel, so each reads what the others
  wrote or imported. Signing out takes the lead, drains, has the gateway sign the device
  out, then forgets the keys and deletes the identity's database; with changes it could
  not send it asks first. While a sign-out runs, no tab of the browser takes a write (a
  `sign-out` hint and the `perch.session.signing-out` mark, which lapses after a minute,
  hold them back), and every write a tab admits holds the Web Lock `perch-write:<id>` shared
  until it is durable; before it reads what is unsent and deletes, the sign-out takes that
  lock exclusive, waiting for writes admitted earlier, and keeps the database (as after
  refused keys) when it does not get it within 10 seconds. A change that still landed after
  the final drain keeps the database. A
  sign-out that asked the gateway in vain (no sign-out close) stops the engine's channel; when
  it leaves the person signed in, the leading tab syncs again on a new engine
  (`IdentitySpace.resumeSync()`), as a change of leader does. Keys
  the gateway refuses sign the device out locally: the identity's database goes with them
  unless it holds changes not sent yet, in which case it stays (as after such a sign-out)
  and the sign-in page says to sign in again (as the same identity) to send them. A
  protocol the gateway refuses stops the sync and keeps everything. A tab follows another
  tab's sign-out by closing its space. The container's runner and write
  path follow the current space and refuse while nobody is signed in. The command bus
  logs each command, validates its params and sets the execution context (actor, device
  and correlation ids). `<html data-boot-step>` shows the boot step; `data-sync-leader`
  and `data-sync-channel` show the tab's sync role and channel.
- `src/platform/`: `defineModule`, `ModuleScope`, `useService`, `useShape`, the router built
  from module routes (each page inside its module's scope; a protected page left open is
  checked again when the user signs out), the ports for the session and for commands,
  notices the shell shows, the language state and the app-wide catalogs.
- `src/features/app-shell/`: the page frame, painted before the database finishes opening.
- `src/features/user/`: signing in or creating an account (`/sign-in`) and the signed-in
  user's profile (`/me`): name, email, a bio of at most 2000 characters saved with the name by
  one Save, and the chosen language, which follows the user across devices, and signing out,
  which asks before losing changes this device could not send. The sign-in page says so when
  the gateway refused the device's keys while it kept changes to send after the next sign-in.

## Key exports

`./seeding`: `openClient({ gatewayUrl })`, a device of the application in Bun or Node (the
composition root over an in-memory database, always leading its identity's sync) whose
`ensureAccount` signs an account up or in through the gateway, writes its profile through
commands and waits until the gateway acknowledged it, and whose `readAccount` signs in and
reads the profile the gateway sends; it leaves each account without signing out.
`openStand()` is the operator's connection to a stand as a system user, where seeded
accounts are swept, and `checkProfileName` the profile name rule the seed catalog is
checked against. Entry point `src/main.tsx`; `src/modules.ts` lists the feature modules;
`src/test-utils.tsx` renders components with the application providers.

## Commands

- `bun run dev`: Vite dev server (port `E2E_WEB_PORT`, default 5180). With `VITE_PUBLIC_PORT`
  set, as the local stands set it, the HMR client dials that port over wss through their
  Caddy front.
- `bun run build`: production build into `dist/`.
- `bun run test`: composition, platform and component tests.
- `bun run model` / `bun run model:check`: generate or check the models of `.surql` files.
- `bun run i18n:check`: translation keys against the catalogs.
- `bun run typecheck`, `bun run lint`.
