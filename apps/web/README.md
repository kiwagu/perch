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
  not send it asks first. Keys the gateway refuses sign the device out locally, and a tab
  follows another tab's sign-out by closing its space. The container's runner and write
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
  user's profile (`/me`): name, email and the chosen language, which follows the user
  across devices, and signing out, which asks before losing changes this device could not
  send.

## Key exports

`./seeding`: `openClient()`, a device of the application in Bun or Node (the composition
root over an in-memory database, always leading its identity's sync) that signs accounts
up or in through the gateway, writes their profiles through commands and waits until the
gateway acknowledged them, leaving without signing out; and `openStand()`, the operator's
connection to a stand as a system user, where seeded accounts are swept. Entry point
`src/main.tsx`; `src/modules.ts` lists the feature modules; `src/test-utils.tsx` renders
components with the application providers.

## Commands

- `bun run dev`: Vite dev server (port `E2E_WEB_PORT`, default 5180). With `VITE_PUBLIC_PORT`
  set, as the local stands set it, the HMR client dials that port over wss through their
  Caddy front.
- `bun run build`: production build into `dist/`.
- `bun run test`: composition, platform and component tests.
- `bun run model` / `bun run model:check`: generate or check the models of `.surql` files.
- `bun run i18n:check`: translation keys against the catalogs.
- `bun run typecheck`, `bun run lint`.
