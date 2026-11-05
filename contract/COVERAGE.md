# Contract coverage

How far the contract reaches, in two measures. The first is the model's, the measure of the
contract's completeness: every field and action of each entity of `model.schema.json`, with
the anchors that bind it, and for each activity across screens the transitions its scenarios
walk. A screen unfolds the model, so a field or an action no anchor binds is a part of the
model no screen shows yet. The second is the code's: how many of the
controls a user can act on carry an anchor, per feature module of the web app and for the UI
kit, which are left unmarked and which are declared off the coverage by a marker, and how
many anchors and scenarios each screen has. `bun run contract:coverage --write` rewrites the
block below from the code and the contract; the text around it is written by hand. The block
stays what that command writes: `bun run contract:coverage:check` fails when it is not, in `bun
run check` and in the pre-commit hook on `main`.

<!-- coverage:start -->

The contract declares 12 screens, 157 anchors and 67 codes.

Totals: fields bound 6/14, actions bound 7/9; activities 1, transitions walked 5/8; controls marked 63/64, ignored 2.

## Model

### profile

| Field or action | Kind | Anchors |
| --- | --- | --- |
| id | field | unbound |
| identity | field | unbound |
| name | field | `user.profile.heading`, `user.profile.name-input` |
| email | field | `user.profile.email-input` |
| bio | field | `user.profile.bio-textarea` |
| created_at | field | unbound |
| createProfile | action | unbound |
| updateName | action | `user.profile.save-button` |
| updateBio | action | `user.profile.save-button` |

### settings

| Field or action | Kind | Anchors |
| --- | --- | --- |
| id | field | unbound |
| identity | field | unbound |
| locale | field | `app-shell.locale-select`, `user.settings.locale-select` |
| theme | field | `app-shell.theme-select`, `user.settings.theme-select` |
| createSettings | action | unbound |
| updateLocale | action | `app-shell.locale-select`, `user.settings.locale-select` |
| updateTheme | action | `user.settings.theme-select` |

### note

| Field or action | Kind | Anchors |
| --- | --- | --- |
| id | field | unbound |
| author | field | unbound |
| text | field | `organisation.notes.text-cell`, `organisation.notes.edit-textarea`, `organisation.notes.new-textarea` |
| created_at | field | unbound |
| createNote | action | `organisation.notes.add-button` |
| updateNote | action | `organisation.notes.save-button` |
| deleteNote | action | `organisation.notes.delete-button` |

## Activities

| Activity | Scenarios | Transitions | Walked |
| --- | ---: | ---: | ---: |
| session | 4 | 8 | 5 |

## Controls

| Module | Controls | Marked | Ignored | Share |
| --- | ---: | ---: | ---: | ---: |
| app-shell | 10 | 10 | 0 | 100% |
| device | 3 | 3 | 0 | 100% |
| not-found | 2 | 2 | 0 | 100% |
| organisation | 14 | 14 | 0 | 100% |
| user | 31 | 31 | 0 | 100% |
| ui kit | 4 | 3 | 2 | 75% |
| all | 64 | 63 | 2 | 98% |

### Unmarked

```text
packages/ui/src/components/ui/toast.tsx:81: button
```

### Ignored

```text
packages/ui/src/components/ui/alert-dialog.tsx:143: Button — rendered by Close with the anchor given to AlertDialogCancel
packages/ui/src/components/ui/sheet.tsx:65: Button — no screen renders a sheet yet; the first one anchors it
```

## Screens

| Screen | Anchors | Scenarios |
| --- | ---: | ---: |
| not-found | 3 | 1 |
| app-shell | 21 | 63 |
| user.confirm-email | 5 | 4 |
| user.delete-account | 4 | 5 |
| device | 10 | 1 |
| user.forgot-password | 6 | 11 |
| user.profile | 10 | 50 |
| organisation | 30 | 12 |
| user.reset-password | 15 | 9 |
| user.settings | 27 | 21 |
| user.sign-in | 19 | 40 |
| user.verify-email | 7 | 6 |

<!-- coverage:end -->

## How it is counted

The numbers are an indicator for the people and the models who move the code onto the
contract, read from the contract files and the source text. They are not a rule of the
contract: nothing fails when they drop, and the contract checks remain what keeps the code
and the tests equal to the contract (`bun run contract:check:sources` for the anchors of the
code, `bun run contract:check:consumers` for those of the e2e tests).

- **Model.** Each entity of `model.schema.json`, its fields (`properties`) and its actions
  (`x-perch.actions`), each with the anchors whose `binding`, alone or in a list, names it:
  `model: <entity>.<field>` or `action: <entity>.<action>`. A field or an action no anchor
  binds is `unbound`. That is a report, not a rule: a field may be internal, such as an id
  or a creation time, and an action may run outside the screens (`createProfile` runs at
  sign-up, through the platform). The totals line counts the fields and the actions bound.
- **Activities.** Each activity of `contract/domain/activities/`, the scenarios whose front matter
  names it in `activity`, its transitions (one per transition of each `on`, a guarded list
  counting each of its branches), and how many of them are walked: a transition from a
  state on an anchor is walked when one of those scenarios names the anchor in a step while
  that step's device is at the address of the state: each device is at the most recent route
  its texts named, read in the order of the file (`where`, the steps and the expected
  results, each left to right), or at the initial state before it names one, and a text that
  opens with `On device X` or `Device X:` belongs to device X, any other to the scenario's
  only device or to the device last named (`A` at first). The totals line adds the
  activities and the transitions walked over all of them, and both it and the table are left
  out while the contract has no activity.
- **Modules.** Each folder under `apps/web/src/features` is a module; `packages/ui/src` is
  the `ui kit`. The `.tsx` sources of each are read, tracked or untracked, without tests,
  declarations, generated files, fixtures and snapshots: the same files the sources check
  reads.
- **Controls.** A JSX element named `button`, `a`, `input`, `select`, `textarea`, `Button`,
  `Link`, `Input`, `Textarea`, `OptionSelect`, `ConfirmDialog`, `AlertDialogAction` or
  `AlertDialogCancel`, or any element with an `onClick`. An element that passes on the
  props it receives (`{...props}`, `{...rest}`) is left out: whoever renders it decides what
  it carries, so the kit's primitives count where they are used, not where they are defined.
  A spread built by a call, such as a form field's `{...field('email')}`, only fills
  attributes, and its element still counts. An element inside a marked control that has no
  `onClick` of its own (an icon or a button inside a marked link) is a part of that control
  and is not counted again.
- **Marked.** A control is marked when it carries `data-testid`, `testId` or a `*TestId`
  prop, whatever the value (a literal, a prop or a constant), or when it sits inside a
  `<label>`, which names it for a locator. Whether the value is an anchor the contract
  declares is the sources check's business, not this count's.
- **Ignored.** A control that is not a test target is declared so in the source, never given
  a made-up anchor: a marker right before its element, with only white space between, and
  its reason on the marker line itself, at least three characters long. In code the marker
  is a line comment, `// ui-contract-ignore: <reason>`; among JSX children it is the only
  content of a comment container, `{/* ui-contract-ignore: <reason> */}`.
  `ui-contract-ignore` covers the element and everything inside it,
  `ui-contract-ignore-self` the element alone. An ignored control is neither marked nor
  unmarked, whatever it carries (an anchor, a `<label>` around it), and is listed with its
  reason; the elements inside it are not taken as its parts. A marker without a reason, in
  another form, not right before an element, or that ignores no control (its element, and
  for `ui-contract-ignore` everything inside it, holds none) is a problem: the command
  prints it, exits 1 and writes nothing.
- **Unmarked.** The controls that are neither marked nor ignored, listed as
  `file:line: <element>`, the element's tag with its `aria-label` or its text when that is a
  static string. `bun run contract:coverage --unmarked` prints the same two lists.
- **Share.** Marked controls over controls, the ignored ones left out, rounded; `-` for a
  module without controls.
- **Screens.** The anchors a screen declares in its screen file, and the scenarios whose
  text (`where`, `scenario`, `steps`, `expected`) names one of its anchors, an anchor derived
  from one of them, or the path of one of its bindings. The frame (`app-shell`) is reached
  by every scenario that waits for its status.
