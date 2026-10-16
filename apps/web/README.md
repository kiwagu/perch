# Web application (`@workspace/web`)

## Role in the architecture

The browser application. It works only with its local replica: a SurrealDB engine in a
Web Worker on IndexedDB, and the signed-in user's private region as a CRDT document that
is projected into that database. Features are Angular-like modules under
`src/features/<feature>` with `domain`, `application` and `presentation` layers; reads and
writes are declared in `.surql` files next to their components and compiled by the
modeling stage.

- `src/composition/`: the composition root, the only code that imports adapters. It opens
  the database once per page, restores the session from the keys kept in local storage
  (saving every renewed refresh key), opens the private region after sign-in, builds the
  command bus (logging, params validation, execution context with actor, device and
  correlation ids) and binds ports to tokens. `<html data-boot-step>` shows the boot step;
  `data-sync-leader` and `data-sync-channel` show the sync role.
- `src/platform/`: `defineModule`, `ModuleScope`, `useService`, `useShape`, the router built
  from module routes (each page inside its module's scope), the ports for the session and
  for commands, notices the shell shows, the language state and the app-wide catalogs.
- `src/features/app-shell/`: the page frame, painted before the database finishes opening.
- `src/features/user/`: signing in or creating an account (`/sign-in`) and the signed-in
  user's profile (`/me`): name, email and the chosen language, which follows the user
  across devices.

## Key exports

None; this is an application. Entry point `src/main.tsx`; `src/modules.ts` lists the feature
modules; `src/test-utils.tsx` renders components with the application providers.

## Commands

- `bun run dev`: Vite dev server (port `E2E_WEB_PORT`, default 5180).
- `bun run build`: production build into `dist/`.
- `bun run test`: composition, platform and component tests.
- `bun run model` / `bun run model:check`: generate or check the models of `.surql` files.
- `bun run i18n:check`: translation keys against the catalogs.
- `bun run typecheck`, `bun run lint`.
