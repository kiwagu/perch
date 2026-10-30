# Anchor patterns

One example per situation, each from a file of our kit, views or machines. `testIdFor(base, suffix)`
from `@workspace/ui-contract/anchors` returns `<base>.<suffix>`; it is the only way to build a
derived anchor. Every anchor below is declared in its screen file first.

The kit's composites that already take an anchor: `ConfirmDialog` (`testId` on the dialog,
`code` as its `data-code`, `.confirm-button` and `.cancel-button` derived), `OptionSelect`
(`testId` on the trigger, `.option` derived with `data-value`) and `AppShell`
(`navigationTestId` on its `<nav>`). Every primitive of `packages/ui/src/components/ui/`
spreads its props, so a call site passes `data-testid` and the other attributes directly.

## 1. A leaf component that spreads its props

`Button` (`packages/ui/src/components/ui/button.tsx`) spreads `...props` onto its element,
so the call site writes the literal and the component changes nothing. From
`apps/web/src/features/user/presentation/pages/profile/profile.view.tsx`:

```tsx
<FieldError data-testid="user.profile.error" data-code={error.code}>
  {error.text}
</FieldError>
<Button
  type="submit"
  disabled={!props.can('user.profile.save-button')}
  data-testid="user.profile.save-button"
>
  {t('user.profile.save')}
</Button>
```

## 2. A composite with one `testId` that derives its parts

`ConfirmDialog` (`packages/ui/src/components/platform/confirm-dialog.tsx`) takes one
`testId`, puts it on the dialog's own box (`AlertDialogContent`, the popup, not the portal
or the overlay) and derives its buttons. The derived names are computed in local constants:
`testIdFor()` inside a conditional in the attribute reads as an anchor built at runtime.

```tsx
const { testId } = props
const confirmTestId = testId === undefined ? undefined : testIdFor(testId, 'confirm-button')
const cancelTestId = testId === undefined ? undefined : testIdFor(testId, 'cancel-button')
// ...
<AlertDialogContent data-testid={testId} data-code={props.code}>
  // ...
  <AlertDialogCancel data-testid={cancelTestId}>{props.cancelLabel}</AlertDialogCancel>
  <AlertDialogAction /* ... */ data-testid={confirmTestId}>{props.confirmLabel}</AlertDialogAction>
```

The call site passes the base and the code (`profile.view.tsx`):

```tsx
<ConfirmDialog
  // ...
  testId="user.profile.sign-out-dialog"
  code="unsent-changes"
/>
```

The screen file lists what the base renders (`contract/domain/screens/me.yaml`):

```yaml
user.profile.sign-out-dialog:
  kind: dialog
  codes: [ unsent-changes ]
  derived: [ confirm-button, cancel-button ]
```

## 3. A part with a screen-level name of its own

When a part is not a derived piece of its composite but an element of the screen with its
own name, the composite takes it as a named prop ending in `TestId`. `AppShell`
(`packages/ui/src/components/platform/app-shell.tsx`) puts `navigationTestId` on its `<nav>`;
the shell view passes the frame's anchor
(`apps/web/src/features/app-shell/presentation/shell/shell.view.tsx`):

```tsx
<AppShell
  brand={t('app.shell.title')}
  navigationLabel={t('app.shell.navigation')}
  navigationTestId="app-shell.nav"
  // ...
/>
```

The links of that navigation are static items, each with its literal under a `testId` key,
which the view renders with `data-testid={item.testId}`:

```tsx
{ to: '/me', label: t('app.shell.nav.profile'), testId: 'app-shell.nav.profile-link' },
```

## 4. One component, a different anchor at each use

A view component used in several places takes the anchor as a prop, and each call site
writes its own literal. `OrganisationErrorLine`
(`apps/web/src/features/organisation/presentation/components/organisation-error-line/organisation-error-line.view.tsx`)
renders `data-testid={props.testId}`, and three forms pass `organisation.create.error`,
`organisation.invite.error` and `organisation.notes.error`.

## 5. Repeated items with `data-id` and a row state

One static anchor marks every entry; the entity's id goes into `data-id`, and an entry that
differs from the others or changes in place carries a row state. A normal entry carries
none. From `apps/web/src/features/device/presentation/pages/devices/devices.view.tsx`:

```tsx
<li
  className="flex flex-wrap items-center justify-between gap-2"
  data-testid="device.list.session-item"
  data-id={device.id}
  data-state={device.current ? 'current' : device.revokedAt ? 'revoked' : undefined}
>
```

Declared in `contract/domain/screens/devices.yaml`:

```yaml
device.list.session-item:
  kind: item
  dataId: device_session
  states: [ current, revoked ]
```

A test scopes by the entry and reads its state
(`tests/e2e/src/device/base/my-devices.e2e.spec.ts`):

```ts
await expect(deviceBRow).toHaveAttribute('data-state', 'revoked')
await expect(deviceBRow.getByTestId('device.list.revoked-cell')).toBeVisible()
```

## 6. A choice with `data-value`

A choice that is not an entity carries the key the code already uses, never its label, and
each fixed value is a row of "Choice values". `OptionSelect`
(`packages/ui/src/components/platform/option-select.tsx`) derives `.option` and puts the
value on each option:

```tsx
<SelectItem
  key={option.value}
  value={option.value}
  className="min-h-11"
  data-testid={optionTestId}
  data-value={option.value}
>
```

A button that switches a mode is one anchor whose value says the mode, never two anchors
(`apps/web/src/features/user/presentation/pages/sign-in/sign-in.view.tsx`):

```tsx
<Button
  type="button"
  variant="link"
  onClick={props.onToggleMode}
  data-testid="user.sign-in.toggle-button"
  data-value={signingUp ? 'sign-in' : 'sign-up'}
>
```

## 7. A notice with `data-code`

The shell's notice carries the code of what it says
(`apps/web/src/features/app-shell/presentation/shell/shell.view.tsx`):

```tsx
<p
  className="text-sm text-muted-foreground"
  role="status"
  data-testid="app-shell.notice-message"
  data-code={props.notice.code}
>
  {props.notice.text}
</p>
```

A domain code never reaches `data-code`: the presentation layer maps it to a contract code,
as `OrganisationErrorLine` does (`'note:FORBIDDEN'` becomes `forbidden`). A test finds the
notice by its anchor and its code together (`tests/e2e/src/support/fixtures.ts`):

```ts
export const notice = (page: Page, code: string) =>
  page.locator(`[data-testid="app-shell.notice-message"][data-code="${code}"]`)
```

## 8. A container with `data-state`

A container whose data arrives after the page says its state, computed from the same value
that decides what it renders, so a test waits for the state and never for a spinner to go.
From `apps/web/src/features/organisation/presentation/components/organisation-notes/organisation-notes.view.tsx`:

```tsx
const state = props.notes === undefined ? 'loading' : props.notes.length > 0 ? 'ready' : 'empty'
// ...
<CardContent
  className="flex flex-col gap-4"
  data-testid="organisation.notes.section"
  data-state={state}
>
```

The app's own readiness works the same way: `app-shell.status` carries
`data-state={props.status}` in `shell.view.tsx`.

## 9. One element drawn by two render paths

When two branches of a view, or two views, draw the same element, the anchor is a
`<NAME>_TEST_ID` constant declared once and used by each, so the literal stays single. No
view needs it yet; the shape is:

```tsx
const NOTES_ITEM_TEST_ID = 'organisation.notes.item'

// in each branch, or in each view that imports it from one module
<li data-testid={NOTES_ITEM_TEST_ID} data-id={note.id}>
```

## 10. An icon-only control

A control without a visible label of its own carries an `aria-label` from a translation key
beside its anchor, so a screen reader and an agent reading the accessibility tree can name
it. `OptionSelect`'s trigger shows the chosen value, not a label, so it takes one
(`option-select.tsx`):

```tsx
<SelectTrigger
  aria-label={props.label}
  data-testid={props.testId}
  className="min-h-11 text-base"
>
```

## 11. An element off the coverage

A control that is not a test target carries a marker with its reason right before its
element, never a made-up anchor. From `packages/ui/src/components/ui/sheet.tsx`, a close
button no screen renders yet:

```tsx
render={
  // ui-contract-ignore-self: no screen renders a sheet yet; the first one anchors it
  <Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />
}
```

And from `packages/ui/src/components/ui/alert-dialog.tsx`, the inner button of a cancel
whose anchor the caller gives to `AlertDialogCancel`:

```tsx
render={
  // ui-contract-ignore-self: rendered by Close with the anchor given to AlertDialogCancel
  <Button variant={variant} size={size} />
}
```

`-self` ignores the element alone; without it the marker covers the element and everything
inside. Among JSX children the marker is the only content of a comment container:
`{/* ui-contract-ignore: <reason> */}`.

## 12. A machine from the flow

A screen's `flow` is an XState v5 machine config, and the app's machine for the screen is
that config with the implementations added. From `contract/domain/screens/sign-in.yaml` (lines
83-95), the state that signs in, written in the shorter forms (a transition as its target,
an effect by its name, the codes of the failure left to the platform's `sign-in`; `bun run
contract:flow user.sign-in` prints the config they expand into, `{ type: show, params: {
anchor, codes } }` and `{ target }`):

```yaml
signing-in:
  invoke:
    src: platform.sign-in
    input: { email: user.sign-in.email-input, password: user.sign-in.password-input }
    onDone:
      target: done
      actions:
        - show: { app-shell.notice-message: [ welcome ] }
        - navigate: /me
    onError:
      target: sign-in
      actions:
        - show: user.sign-in.error
```

And `apps/web/src/features/user/application/sign-in.machine.ts` (lines 72-121): an actor
per `invoke.src`, the effects, the same states, events, targets and effects; what the
app adds is its own (the `error` in context, `clearError`, the `input` built from the
submit event):

```ts
return setup({
  types: { context: {} as SignInContext, events: {} as SignInEvent, emitted: {} as SignInEmitted },
  actors: {
    'platform.sign-in': attempt(service, 'sign-in'),
    'platform.sign-up': attempt(service, 'sign-up'),
  },
  actions: {
    show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
      if (params.anchor === SIGN_IN_ERROR) {
        enqueue.assign({ error: failureOf(event) })
      } else {
        enqueue.emit({ type: 'show', ...params })
      }
    }),
    navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
    clearError: assign({ error: undefined }),
  },
}).createMachine({
  // ...
  'signing-in': {
    entry: 'clearError',
    invoke: {
      src: 'platform.sign-in',
      input: formInput,
      onDone: {
        target: 'done',
        actions: [
          { type: 'show', params: { anchor: 'app-shell.notice-message', codes: ['welcome'] } },
          { type: 'navigate', params: { to: '/me' } },
        ],
      },
      // onError: back to 'sign-in', showing the codes on user.sign-in.error
    },
  },
})
```

The events are the anchors the user acts on (`{ type: 'user.sign-in.submit-button', form }`),
and the mode is the state (`sign-in`, `sign-up`), not context. An actor resolves with its
result and rejects with the failure, so `onDone` and `onError` are the action's success and
failure. The page sends the events and does what the machine emits: the sign-in container
(`presentation/pages/sign-in/sign-in.container.tsx`, lines 50-62) notifies the welcome on
`show` and moves on `navigate`. `apps/web/src/platform/machines.spec.ts` holds the
machine's config to the flow through the engine's comparison
(`@workspace/ui-contract/machines`); a new app machine for a screen joins its `APP_MACHINES`.

A screen whose areas are independent runs them at once as the regions of a parallel state.
From `contract/domain/screens/org.yaml` (lines 195-277, the descriptions, the notes' items and the
invitation left out), the organisation page: its own event leaves `viewing` whatever each
region is in, and each region moves on its own events only, the create included. The create
form is written in full, a shape no other region has. The new note is not written at all:
`organisation.notes.add-button` runs one action, so the loader derives its region
`notes-add` (`idle`, and `running`, which invokes `note.createNote` and shows a failure on
`organisation.notes.error`). The members are the region of their button, with the one thing
the screen decides: a failure shows under the invitation.

```yaml
viewing:
  type: parallel
  on:
    organisation.page.current-select: selecting
  states:
    create-form:
      initial: closed
      states:
        closed:
          on:
            organisation.create.toggle-button: open
            organisation.create.submit-button: submitting
        open:
          on:
            organisation.create.toggle-button: closed
            organisation.create.submit-button: submitting
        submitting:
          invoke:
            src: platform.organisations.create
            input: { key: organisation.create.key-input, name: organisation.create.name-input }
            onDone:
              target: "#organisation.viewing"
            onError:
              target: open
              actions:
                - show: organisation.create.error
    members:
      by: organisation.members.remove-button
      onError:
        actions:
          - show: organisation.invite.error
```

A target in a region names a state of that region or, by the flow's `id` (a one-segment
name the flow declares, which the app gives its machine), a state of the root as
`#<flow id>.<state>`: a done create re-enters `viewing`, every region at its `initial`, while
a failed one stays in its area. A target of the root may name a
region's state as `<parallel>.<region>.<state>`, the other regions at their `initial`.
Within a parallel state an event is handled by one region or by the state's own `on`, never
by two (`contract:check` says which two). A region has no `type`, no `meta.address` and no
nested states; where the app keeps a state per item (each note's edit form), the region
follows the item acted on last and its `description` says so.

A field whose value the person types and the store changes on its own is a region of its own,
following the stored value or holding what was typed. A data event, `model.<entity>.<field>`,
is the stored value of a field the screen shows changing, here or on another device. From
`contract/domain/screens/me.yaml`, the profile's name (descriptions left out):

```yaml
name:
  initial: following
  states:
    following:
      on:
        user.profile.name-input:
          target: edited
    edited:
      on:
        user.profile.name-input:
          target: following
          guard: nameIsStored
        model.profile.name:
          target: following
          guard: nameIsStored
```

In `following` the input shows the stored name; in `edited` it shows what was typed, and a
name stored on another device changes nothing until the guard holds (its own Save landed, the
profile storing it trimmed). The page sends the data event when the shape's value changes.

A control whose anchor is an event of the flow (a button, a select, a switch) is enabled
exactly while a state the machine is in handles that event: the view asks the machine (`snapshot.can({ type: anchor })`, passed to
the view as `can`) and keeps no flag of its own, so Save is disabled while `saving-name` or
`saving-bio` runs and the sign-out button while the sign-out does.
