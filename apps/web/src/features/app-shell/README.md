# Application shell (module `app-shell`)

## Role in the architecture

The page frame every module renders into. It runs the frame's flow (`contract/domain/screens/__root.yaml`)
as its machine from the start of the page, before the local database finishes opening, and
carries a signed-in account's navigation (the profile, the organisation page, My devices and
the settings, and the console for an operator alone, each link shown to the roles of its anchor,
`navigation-links-contract.spec.ts`; a guest sees none, only the banner and the page), the theme and language switches
for a guest (a signed-in account chooses its theme and its language on the settings screen;
a guest's other tabs follow a theme it chooses, `platform.theme-set`, which the start sends the
frame's machine from the moment the services exist, as every screen's machine hears the
platform's events, and which a signed-in tab ignores), and follows a language and a theme another
tab or device stores (`model.settings.locale`,
`model.settings.theme`, handed by `presentation/shell/stored-settings.ts` only while the frame's
state takes the event and counted as seen only then, so a value that comes while the data opens
or the app installs applies once the frame is back, the first read after the data opened counting
as one this tab has not seen; a value this tab stored itself is only noted; a theme it shows is kept on the device as the theme it showed last, which the next
start and the guest pages after a sign-out show), the notice and the toasts the flows say, and the
notices of a change the gateway refused and this device undid, so the change does not just
vanish, and, when the gateway refused the undo too, that the later changes not sent yet went
with it (the bus's `sync.change-rejected` and `sync.changes-reloaded` reach the frame's flow as
its platform events through `application/shell.events.ts`); a notice goes when the account it
was raised for signs out, here or from another device, or another account takes its place
(`platform.signed-out`, which `presentation/shell/signed-out.ts` hears from the session: the shell
container while a screen renders, `src/main.tsx` while none does), and a sign-in on this device, in this tab
or another (`platform.signed-in`, which `presentation/shell/signed-in.ts` hears from the session
in every state, from `src/main.tsx`), ends the words the sign-in page had not said yet. It offers to load the page again when
the server serves a newer build than the tab runs, or no longer takes this build's sync
protocol, and shows a signed-in account the state of this device's sync. The folder has no
module manifest: the composition root mounts the shell around the router built from the
modules' routes.

## Surface

- `application/shell-machine/`: the frame's flow as its machine (held to the contract by
  `platform/machines.spec.ts`; `machine.ts` assembles the events and deps of `events.ts` and
  the transitions several states share, `transitions.ts`; `frame-states.ts` names each state of the
  two regions of `running`, `screen` and `install`, as the partial value `matches` takes), made by
  the start (`src/main.tsx`) through
  `presentation/shell/shell-frame.tsx` and handed to the shell container; `setting-writes.ts`
  tells a setting another tab or device stored from this tab's own write coming back.
- `presentation/shell/shell.container.tsx` and `shell-view/`: the frame (`frame.view.tsx` lays it
  out in the kit's `AppShell`, a child view for each of its parts: the status line, the header's
  actions, the navigation links, the update and install alerts, the notice's line, the toasts,
  "Sign out on this device" and the message of a screen that failed to render), the navigation
  for a signed-in account only (for a guest the kit's `AppShell` renders no `<nav>`, neither the
  bottom bar nor the side rail, and the page takes their room), the notice, whose line is held as tall as the longest notice (three lines on a phone, two
  wider up, a guard in `texts-contract.spec.ts`) so the page does not move, and the toasts
  (`app-shell.toast`, the kit's `Toaster` centred at the top, the newest first, each in its tone
  and gone after a few seconds or a click); a guest's theme select (`platform/theme.ts`'s
  `useDeviceTheme` gives its value, the machine's `setTheme` the device's choice, at the start, a
  crash or data that failed to open alike), the guest's language select and "Sign out on this
  device" are enabled while the machine's state takes them, and the navigation, the reload and
  "Sign out on this device" show while the state renders them, read from the machine
  (`platform/screen-renders.ts`), each state the page settles in reported as `app-shell` in an e2e
  run (`platform/settled-report.ts`, from `main.tsx`); the unrouted states (`opening`,
  `failed`, `signing-out`) render the frame as for a guest, both selects included. Before the router renders, the shell says where the start is: starting
  (`opening`), a browser that keeps no site data, or data that could not be opened, which offers
  "Sign out on this device" when an account is saved. Once started (`platform.started`), a
  guest's page renders ready, and a signed-in account's frame and open screen render while its
  data opens (`opening-data`, until `platform.opened`): the status line says so beside the
  screen, and what the platform says (a refused change, the sync, an update, the install
  reminder, a screen that failed to render) reaches the flow only once the data is open, when
  the container starts listening to it.
- A screen that fails to render: the router puts `presentation/crash/crash-signal.tsx`
  (`CrashSignal`, handed to `createAppRouter` as `crash` by the start) in the page's place; it
  raises the frame's platform event `platform.crashed`, once the data is open when the page
  failed while it opened, and keeps the page's `reset` in the frame (`renderAgain`). The frame's flow then shows `app-shell.crash-message` (`screen-crashed`)
  with `app-shell.reload-button` in the screen's place, a signed-in account's navigation, a
  guest's theme and language selects still around it. Another screen opening (`platform.navigated`, sent when the router starts a
  navigation) takes the message away; a language chosen renders the page again; the reload
  button asks the leave guard first (a leaving control) and loads the page again
  (`platform.reload`, `window.location.reload()`).
- An update: the shell container watches the build the server serves (`SERVED_BUILD`, the
  frame's platform event `platform.new-version`, with the build named), and the bus's
  `sync.protocol-refused` reaches the flow as `platform.protocol-refused`; a refusal heard
  before the container listened (the sync of a saved account starts with the page) is read from
  the session on mount (`protocolRefused()`). The flow shows
  `app-shell.update-message` (`new-version`, or `protocol-outdated`, which a newer build heard
  later does not replace) with `app-shell.update-button` above the page, in `running` whatever the
  screen and the install window are doing, until the page loads again. The button asks the leave guard first (a leaving control)
  and loads the page again. The tab going to the background (`platform.tab-hidden`, sent on
  `visibilitychange`) loads it again by itself when an update waits, no field holds unsaved
  input (`live.unsaved`, from the kit's `useUnsavedInput`) and this tab has not done so for the
  same update before (`tabSelfReloads`, every such update one per line in the tab's
  `sessionStorage` under `perch.update.reloaded`), so a server still serving an update after the
  reload, or alternating two, starts no loop.
  Only the tab that leads the sync hears a refused protocol; the others see the newer build.
- The state of the sync: the shell container reads `SYNC_STATUS` (`useSyncExternalStore`) and
  sends its value as the frame's platform event (`platform.synced`, `platform.sending`,
  `platform.connecting`, `platform.offline`, `platform.sync-stopped`) while an account is signed
  in; the flow shows `app-shell.sync-message` with that code in the header, in `running` whatever
  the screen and the install window are doing, and clears it when the account signs out. On a phone it takes two short lines at most.
- Installing the app: the shell container reads the device's install (`platform/install.ts`,
  `useDeviceInstall`) and sends its offer as the frame's platform event (`platform.install-offered`,
  `platform.install-by-steps`, `platform.installed`); the flow shows `app-shell.install-message`
  above the page in `running` (`install-available` with `app-shell.install-button`, or
  `install-by-steps` with the steps), whatever the screen is doing, and both its buttons run an
  invoke in the `install` region (`installing`: the browser's window, a decline put off as later;
  `postponing`: three days on this device) that clears it. Its buttons take nothing around a
  crash or a page loading again (the guard `screenReady`), and no quiet reload starts while the
  browser's window is open.
- Page titles: the shell sets the browser tab's title from the screen the router resolved
  (`platform/resolved-route.ts`: the not-found screen's for a page whose roles the device does
  not hold, as for an unknown address, so the title never names a screen refused; the
  navigation marks the same screen current), "<screen> · Perch"
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
  runs (`useLeaveGuard().before(control)`); before a control whose flow moves to another screen
  it asks only while a field that move loses holds unsaved input, or a field that renders no
  anchor (the kit's `useUnsavedFields()`), and turns on the browser's own prompt for a
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

- `bun run test` in `apps/web` runs its specs (`shell-machine/machine.spec.ts`, `shell.events.spec.ts`,
  `setting-writes.spec.ts`, `shell-frame.spec.ts`, `stored-settings.spec.ts`,
  `shell.container.spec.tsx`,
  the specs of `shell-view/`, `leave-guard.container.spec.tsx`, `confirm-guard.container.spec.tsx`).
