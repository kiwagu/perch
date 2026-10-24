# Application shell (module `app-shell`)

## Role in the architecture

The page frame every module renders into. It runs the frame's flow (`contract/screens/__root.yaml`)
as its machine from the start of the page, before the local database finishes opening, and
carries the navigation (sign-in, or the profile, the organisation page and My devices), the
language switch, which stores the chosen language in the account's settings from any page and
follows a language another device stores, and the notices the session raises, such as a change the
gateway refused and this device undid, so the change does not just vanish, and, when the gateway
refused the undo too, that the later changes not sent yet went with it; a notice goes when the
account it was raised for signs out, here or from another device. The folder has no
module manifest: the composition root mounts the shell around the router built from the
modules' routes.

## Surface

- `application/shell.machine.ts`: the frame's flow as its machine (held to the contract by
  `platform/machines.spec.ts`), made by the start (`src/main.tsx`) through
  `presentation/shell/shell-frame.tsx` and handed to the shell container; `locale-writes.ts`
  tells a language another device stored from this device's own write coming back.
- `presentation/shell/shell.container.tsx` and `shell.view.tsx`: the frame, the navigation
  and the notices; the language select and "Sign out on this device" are enabled while the
  machine's state takes them. Before the frame is mounted, the shell says where the start is: opening the
  data, a browser that keeps no site data, or data that could not be opened, which offers
  "Sign out on this device" when an account is saved.
- Anchors: screen `app-shell` in `contract/screens/__root.yaml`.
- No shapes or commands of its own: it reads the session and the notices through the platform
  ports, and the account's settings through `SETTINGS_SERVICE` and the settings shape of the
  user module, which the composition root provides app-wide.
- i18n keys `app.shell.*` live in the app-wide catalog `src/platform/i18n/app.en.json`.

## Commands

- `bun run test` in `apps/web` runs its specs (`shell.machine.spec.ts`, `locale-writes.spec.ts`,
  `shell.container.spec.tsx`, `shell.view.spec.tsx`).
