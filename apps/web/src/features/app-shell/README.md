# Application shell (module `app-shell`)

## Role in the architecture

The page frame every module renders into. It is painted before the local database finishes
opening and carries the navigation (sign-in, or the profile and the organisation page), the
language switch and the notices the session raises, such as a change the gateway refused and
this device undid, so the change does not just vanish. The folder has no module manifest: the
composition root mounts the shell around the router built from the modules' routes.

## Surface

- `presentation/shell/shell.container.tsx` and `shell.view.tsx`: the frame, the navigation
  and the notices. The test id `app-shell.ready` marks the mounted frame; the e2e fixtures
  wait for it.
- No shapes or commands of its own: it reads the session, the language state and the
  notices through the platform ports.
- i18n keys `app.shell.*` live in the app-wide catalog `src/platform/i18n/app.en.json`.

## Commands

- `bun run test` in `apps/web` runs its specs (`shell.container.spec.tsx`,
  `shell.view.spec.tsx`).
