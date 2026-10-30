# Application shell (module `app-shell`)

## Role in the architecture

The page frame every module renders into. It runs the frame's flow (`contract/domain/screens/__root.yaml`)
as its machine from the start of the page, before the local database finishes opening, and
carries the navigation (sign-in, or the profile, the organisation page and My devices), the
theme switch of this device for anyone (the device theme the settings screen chooses too), the
language switch for a guest (a signed-in account chooses its language on the settings screen), and follows a language another device stores, the notice and the toasts the flows say, and the
notices of a change the gateway refused and this device undid, so the change does not just
vanish, and, when the gateway refused the undo too, that the later changes not sent yet went
with it (the bus's `sync.change-rejected` and `sync.changes-reloaded` reach the frame's flow as
its platform events through `application/shell.events.ts`); a notice goes when the account it
was raised for signs out, here or from another device. The folder has no
module manifest: the composition root mounts the shell around the router built from the
modules' routes.

## Surface

- `application/shell.machine.ts`: the frame's flow as its machine (held to the contract by
  `platform/machines.spec.ts`), made by the start (`src/main.tsx`) through
  `presentation/shell/shell-frame.tsx` and handed to the shell container; `locale-writes.ts`
  tells a language another device stored from this device's own write coming back.
- `presentation/shell/shell.container.tsx` and `shell.view.tsx`: the frame, the navigation,
  the notice, whose line is held as tall as the longest notice (three lines on a phone, two
  wider up, a guard in `texts-contract.spec.ts`) so the page does not move, and the toasts
  (`app-shell.toast`, the kit's `Toaster` centred at the top, the newest first, each in its tone
  and gone after a few seconds or a click); the theme select (`platform/theme.ts`'s
  `useDeviceTheme` gives its value, the machine's `setTheme` the device's choice, at the start, a
  crash or data that failed to open alike), the guest's language select and "Sign out on this
  device" are enabled while the machine's state takes them. Before the frame is mounted, the shell says where the start is: opening the
  data, a browser that keeps no site data, or data that could not be opened, which offers
  "Sign out on this device" when an account is saved.
- A screen that fails to render: the router puts `presentation/crash/crash-signal.tsx`
  (`CrashSignal`, handed to `createAppRouter` as `crash` by the start) in the page's place; it
  raises the frame's platform event `platform.crashed` and keeps the page's `reset` in the
  frame (`renderAgain`). The frame's flow then shows `app-shell.crash-message` (`screen-crashed`)
  with `app-shell.reload-button` in the screen's place, the navigation, the theme select and the
  language select still around it. Another screen opening (`platform.navigated`, sent when the router starts a
  navigation) takes the message away; a language chosen renders the page again; the reload
  button asks the leave guard first (a leaving control) and loads the page again
  (`platform.reload`, `window.location.reload()`).
- Page titles: the shell sets the browser tab's title from the route matched, "<screen> · Perch"
  in the language the app speaks (`presentation/shell/page-title.ts`: `PAGE_TITLES`, one literal
  key per screen, `app.title.<screen id>`, by the path of its route; the app's name alone where no
  screen is open), held to every binding of the contract by `page-titles-contract.spec.ts`.
- `presentation/shell/notice-texts.ts` and `toast-texts.ts`: the words of each code of
  `app-shell.notice-message` and of `app-shell.toast` (a toast's tone too: a derived code says a
  success), one literal key each; the start hands
  them to the platform's notice and toast channels (`NoticeProvider`, `ToastProvider`).
  `texts-contract.spec.ts` holds both maps to the codes the contract gives the two anchors, the
  toast's codes derived from the operations the flows run (an action of the model, or a
  platform action the platform's `toasts` map lists): a new one fails it until its words are
  written, except on a branch (`CONTRACT_AHEAD=1`), where a business commit may run ahead.
- `presentation/leave-guard/leave-guard.container.tsx`: the guard of unsaved input, which the
  start mounts inside the kit's `UnsavedInputScope` around the shell. It follows the
  platform's `unsavedInput` (`platform/leaving.ts`, `LEAVE_POLICY`): while a field holds
  unsaved input it asks through `app-shell.leave-dialog` (code `unsaved-input`; leave or
  stay) before another screen opens, a link, Back or Forward, and before a leaving control
  runs (`useLeaveGuard().before(control)`), and turns on the browser's own prompt for a
  reload, a closed tab or an address typed by hand. A change of search inside one screen, a
  flow's own navigation (`useScreenMachine`) and a leave nobody started here pass. The
  language select asks it first, and carries `holdsInput={false}`: its choice applies at
  once.
- `presentation/confirm-guard/confirm-guard.container.tsx`: the frame's confirmation, which the
  start mounts around the shell. Before a control whose action destroys what it acts on sends
  its event (`useScreenMachine` asks `useConfirmGuard().before(control)`, then the leave guard
  for a leaving control), it asks through `app-shell.confirmation` with the code of that action
  (`platform/confirmations.ts`); confirm lets the event go, cancel drops it, a second question
  replaces the first and another screen drops it. `presentation/shell/confirm-texts.ts`
  (`CONFIRM_TEXTS`) words each code (title, body, the confirm label), held to the
  confirmation's codes by `texts-contract.spec.ts`.
- Anchors: screen `app-shell` in `contract/domain/screens/__root.yaml`.
- No shapes or commands of its own: it reads the session, the notices, the toasts and the app's
  events through the platform ports, and the account's settings through `SETTINGS_SERVICE` and the settings shape of the
  user module, which the composition root provides app-wide.
- i18n keys `app.shell.*` live in the app-wide catalog `src/platform/i18n/app.en.json`.

## Commands

- `bun run test` in `apps/web` runs its specs (`shell.machine.spec.ts`, `locale-writes.spec.ts`,
  `shell.container.spec.tsx`, `shell.view.spec.tsx`, `leave-guard.container.spec.tsx`,
  `confirm-guard.container.spec.tsx`).
