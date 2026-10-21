# Application shell (module `app-shell`)

## Role in the architecture

The page frame every module renders into. It is painted before the local database finishes
opening and carries the navigation (sign-in, or the profile, the organisation page and My
devices), the language switch and the notices the session raises, such as a change the
gateway refused and this device undid, so the change does not just vanish, and, when the gateway
refused the undo too, that the later changes not sent yet went with it. The folder has no
module manifest: the composition root mounts the shell around the router built from the
modules' routes.

## Surface

- `presentation/shell/shell.container.tsx` and `shell.view.tsx`: the frame, the navigation
  and the notices. Before the frame is mounted, the shell says where the start is: opening the
  data, a browser that keeps no site data, or data that could not be opened, which offers
  "Sign out on this device" when an account is saved.
- Anchors: screen `app-shell` in `contract/screens.json`.
- No shapes or commands of its own: it reads the session, the language state and the
  notices through the platform ports.
- i18n keys `app.shell.*` live in the app-wide catalog `src/platform/i18n/app.en.json`.

## Commands

- `bun run test` in `apps/web` runs its specs (`shell.container.spec.tsx`,
  `shell.view.spec.tsx`).
