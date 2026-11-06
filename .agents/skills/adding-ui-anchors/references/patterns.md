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
(`apps/web/src/features/app-shell/presentation/shell/shell-view/frame.view.tsx`):

```tsx
<AppShell
  brand={t('app.shell.title')}
  navigationLabel={t('app.shell.navigation')}
  navigationTestId="app-shell.nav"
  // ...
/>
```

The links of that navigation are static items, each with its literal under a `testId` key,
which `NavigationLinks` (`shell-view/navigation-links.view.tsx`) renders with
`data-testid={item.testId}`:

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
  onClick={() =>
    props.onToggleMode({ password: values.password, confirmation: values.confirmation })
  }
  data-testid="user.sign-in.toggle-button"
  data-value={signingUp ? 'sign-in' : 'sign-up'}
>
```

## 7. A notice with `data-code`

The shell's notice carries the code of what it says
(`apps/web/src/features/app-shell/presentation/shell/shell-view/notice-line.view.tsx`):

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

A message whose codes more than one source may raise before it shows (an effect of the app
and a flow's `show` on its way there) is declared `ranked: true`, its `codes` in rank order:
the app shows the first of those raised and drops the others, and a spec of the app holds its
own order to the anchor's `codes` (`contract:diff` lists the order as
`<anchor> ranks <code> > <code>`).

```yaml
<screen>.<object>-message:
  kind: message
  ranked: true
  codes: [ <the code that says the most>, <the next>, <the last> ]
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
`data-state={props.status}` in `shell-view/status-line.view.tsx`.

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
that config with the implementations added. The state that signs in on the sign-in screen,
`contract/domain/screens/sign-in.yaml`, in the shorter forms (the descriptions left out; a
transition as its target, an effect by its name; `bun run contract:flow user.sign-in` prints
the config they expand into, `{ type: show, params: { anchor, codes } }` and `{ target }`),
with its guard `emailNotVerified: { codes: [ email-not-verified ] }` (pattern 16), so the
first branch of its `onError` shows `email-not-verified` and the second `invalid-credentials`,
`rate-limited`, `other-account` and `failed`, the rest of the failure of `platform.sign-in`:

```yaml
signing-in:
  entry:
    - clear: user.sign-in.error
  invoke:
    src: platform.sign-in
    input: { email: user.sign-in.email-input, password: user.sign-in.password-input }
    onDone:
      target: done
      actions:
        - show: { app-shell.notice-message: [ welcome ] }
        - navigate: /me
    onError:
      - target: unverified
        guard: emailNotVerified
        actions:
          - show: user.sign-in.error
      - target: sign-in
        actions:
          - show: user.sign-in.error
```

`clear: user.sign-in.error` takes the code off the form's error; a `clear` that names a
field of the screen empties it instead, a secret one included, so it holds no input any more.

And the machine, in its folder `apps/web/src/features/user/application/sign-in-machine/`
(`machine.ts` lines 65-252, its guards in `guards.ts` lines 43-50): an actor per
`invoke.src`, a guard per name of `meta.guards`, the same states, events, targets and
effects; what the app adds is its own (the `error` in context, which its `show` and `clear`
keep for the form's error, the guards' code, the `input` built from the submit event), and
`clearError` and `showError(...codes)` are the flow's effects on that error, written once.
The guards read what the event carries, the passwords as typed among it:

```ts
export const signInGuards = {
  emailNotVerified: ({ event }: GuardArgs) =>
    failureOf(event, UNKNOWN_FAILURE) === 'data:EMAIL_NOT_VERIFIED',
  passwordBreaksRules: ({ event }: GuardArgs) => !keepsPasswordRules(passwordsOf(event).password),
  // passwordsDiffer, confirmationStrays, confirmationFollows: the password typed again
}
```

```ts
return setup({
  types: {
    context: {} as SignInContext,
    events: {} as SignInEvent,
    emitted: {} as SignInEmitted,
  },
  guards: signInGuards,
  actors: {
    'platform.sign-in': fromPromise(
      ({ input }: { readonly input: { readonly form: SignInForm } }) =>
        settled(service.signIn(input.form)),
    ),
    // 'platform.sign-up', 'platform.resend-verification'
  },
  actions: {
    show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
      if (params.anchor === SIGN_IN_ERROR) {
        // The form finds the passwords differ itself; any other code is the failure's.
        enqueue.assign({
          error: params.codes.includes('passwords-differ')
            ? PASSWORDS_DIFFER
            : failureOf(event, UNKNOWN_FAILURE),
        })
      } else if (params.anchor === MAIL_MESSAGE) {
        // ... the mail message's code
      } else {
        enqueue.emit({ type: 'show', ...params })
      }
    }),
    // clear: the same, anchor by anchor
    navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
  },
}).createMachine({
  // ...
  'signing-in': {
    entry: [clearError],
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
      onError: [
        {
          target: 'unverified',
          guard: 'emailNotVerified',
          actions: [showError('email-not-verified')],
        },
        {
          target: 'sign-in',
          actions: [
            showError('invalid-credentials', 'rate-limited', 'other-account', 'failed'),
          ],
        },
      ],
    },
  },
})
```

The events are the anchors the user acts on (`{ type: 'user.sign-in.submit-button', form,
confirmation }`, the password typed again beside the form the actors take; `{ type:
'user.sign-in.password-input', password, confirmation }` for a keystroke, and the same two on
`user.sign-in.toggle-button`, judged on the way into sign-up), and the mode is the state
(`sign-up`, `password-weak` and `passwords-differ` are the mode sign-up), not context. An actor resolves
with its result and rejects with the failure (`settled` and `failureOf` of
`apps/web/src/platform/actor-outcome.ts`), so `onDone` and `onError` are the action's success
and failure. The page sends the events and reads what the machine keeps: the sign-in container
(`presentation/pages/sign-in/sign-in.container.tsx`, lines 73-94) renders the view from the
state and its context and sends each event, and `useScreenMachine`
(`apps/web/src/platform/screen-machine.ts`) does what the machine emits, the welcome on the
frame's notice through `useFrameEffects` and the move on `navigate`.
`apps/web/src/platform/machines.spec.ts` holds the machine's config to the flow through the
engine's comparison (`@workspace/ui-contract/machines`); a new app machine for a screen joins
its `APP_MACHINES`.

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

## 13. A password input's eye

A password input may render an eye beside itself that shows what it holds as typed, or hides
it again: the derived `visibility-button`. It is presentation only. Whether the field shows
its value is the one transient state a component keeps of its own, never a state of the flow:
the eye is no event of the flow, the machine does not enable it, and it is always enabled. Its
`data-value` says what a click does, `show` or `hide`, the suffix's own values, never rows of
"Choice values". This example is illustrative, not a file of the app. The screen file lists
the suffix on the input, which says it holds a secret, as only a secret input renders an eye:

```yaml
user.sign-in.password-input:
  kind: input
  secret: true
  derived: [ visibility-button ]
```

A kit composite takes the input's `testId` and derives the eye, as `ConfirmDialog` derives its
buttons:

```tsx
const [shown, setShown] = useState(false)
const eyeTestId = testId === undefined ? undefined : testIdFor(testId, 'visibility-button')
// ...
<Input {...props} type={shown ? 'text' : 'password'} data-testid={testId} />
<Button
  type="button"
  aria-label={shown ? props.hideLabel : props.showLabel}
  aria-pressed={shown}
  data-testid={eyeTestId}
  data-value={shown ? 'hide' : 'show'}
  onClick={() => setShown((value) => !value)}
/>
```

A test clicks it and reads what the next click does:

```ts
const eye = page.getByTestId('user.sign-in.password-input.visibility-button')

await eye.click()
await expect(eye).toHaveAttribute('data-value', 'hide')
```

## 14. A notice mail

A platform action that changes what protects an account tells its owner, by a mail that
carries no token: a notice. A `mail` is something to act on (a link with a token); a notice
only tells, and at most links plainly to a screen. The action lists its notices by name
under `notices`, beside its `mail` when it has one. `to: account` is the account's email as
it was before the action changed anything, so the confirmed change of an email tells the old
address. This example is illustrative, not a file of the app:

```yaml
confirm-email-change:
  # description, params (token), result, codes
  notices:
    - name: email-changed
      to: account
      language: account
      link: { screen: user.reset-password }
```

The link of a notice opens a screen whose every route needs no parameter, and never carries a
`search`. A scenario names the notice by its action and its name:

```markdown
- [notice:confirm-email-change.email-changed] reaches the old address
```

## 15. What a state renders

An anchor that only some states of a screen render is listed in `meta.renders` of each state
that renders it; an anchor no state lists is rendered in every state. The state decides, never
the code an anchor shows. For the mode sign-up of the sign-in screen,
`contract/domain/screens/sign-in.yaml` (the descriptions and the other states left out):

```yaml
sign-up:
  meta:
    renders: [ user.sign-in.password-rule-list, user.sign-in.password-confirmation-input, user.sign-in.name-input ]
  on:
    user.sign-in.password-confirmation-input:
      target: passwords-differ
      guard: confirmationStrays
    # the toggle, the password and the submit as before
signing-up:
  meta:
    renders: [ user.sign-in.password-rule-list, user.sign-in.password-confirmation-input, user.sign-in.name-input ]
  invoke:
    src: platform.sign-up
    # input and onDone as before
```

`sign-up` handles the confirmation's event, so it lists it, or `contract:check` says it is
handled here but not rendered. `signing-up` handles none of their events and lists them all
the same: the fields stay on the page, disabled, and the rule list with them, while the
account is created. A derived part goes with its base (list `user.sign-in.password-input`,
never its `visibility-button`), and the anchors declared under a listed one
(`<anchor>.<rest>`) come with it: the rule list brings its six items, so a state lists the
list alone, never the list and an item in one list; an item is rendered where its list is, or
where a state lists it itself, and an event on it is held through its list. A state of a
region renders what it lists and what its parallel state lists; a region written by its
pattern or by its button takes no `meta`, so an area whose anchors come and go is written in
full. `contract:diff main` shows each entry, `sign-up renders user.sign-in.name-input`.

Rendered means visible to the user: in a state that does not render it, an anchor is absent
from the page or kept in it hidden, as a closed form that keeps what was typed. So a form that
stays in the DOM while it is closed is still listed only in the states where it is open. The
view asks the machine, `isRendered(renderedAt(snapshot.machine.config, snapshot.value),
anchor)`, never a flag of its own, and an e2e run holds every settled state of a test to the
list.

## 16. A guard by failure code

A guard that tells the failures of an invoke apart names the codes it takes instead of a
sentence, and the bare `show` of its branch shows them. For the state `signing-in` of the
sign-in screen (pattern 12), its `onError` in the shortest form; a screen may write the codes
of a `show` out instead, and what it writes wins:

```yaml
flow:
  meta:
    guards:
      emailNotVerified: { codes: [ email-not-verified ] }
  states:
    signing-in:
      invoke:
        src: platform.sign-in
        # input and onDone as before
        onError:
          - target: unverified
            guard: emailNotVerified
            actions:
              - show: user.sign-in.error
          - target: sign-in
            actions:
              - show: user.sign-in.error
```

The first branch shows `email-not-verified`; the second, after it, the failure of
`platform.sign-in` less the codes the guard took: `invalid-credentials`, `rate-limited`,
`other-account` and `failed` (`bun run contract:flow user.sign-in` prints both). The error
still carries every code of the failure. A guard may take several codes
(`linkUnusable: { codes: [ link-invalid, link-expired ] }` on the reset-password screen). It
guards only branches of an invoke's `onError`, a region written `by` its button included, and
each code is one the action fails with, listed once; a guard that says anything else stays a
sentence. The app implements it as any guard, by the failure the actor rejected with (pattern
12's `emailNotVerified`). `contract:diff main` shows `guard emailNotVerified takes
email-not-verified`.
