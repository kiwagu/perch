# Contract coverage

How far the contract reaches. First into the model, the measure of its completeness: which
fields and actions of each entity an anchor binds. Then into the code: how many of the
controls a user can act on carry an anchor, per feature module of the web app and for the UI
kit, which are left unmarked and which are declared off the coverage, and how many anchors
and scenarios each screen has. `bun run contract:coverage --write` rewrites the block below
from the code and the contract; the text around it is written by hand.

<!-- coverage:start -->

The contract declares 5 screens, 67 anchors and 29 codes.

Totals: fields bound 4/11, actions bound 6/7; controls marked 33/33, ignored 2.

## Model

### profile

| Field or action | Kind | Anchors |
| --- | --- | --- |
| id | field | unbound |
| identity | field | unbound |
| name | field | `user.profile.heading`, `user.profile.name-input` |
| email | field | `user.profile.email-input` |
| bio | field | `user.profile.bio-textarea` |
| locale | field | unbound |
| created_at | field | unbound |
| createProfile | action | unbound |
| updateName | action | `user.profile.save-button` |
| updateBio | action | `user.profile.save-button` |
| updateLocale | action | `app-shell.locale-select` |

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

## Controls

| Module | Controls | Marked | Ignored | Share |
| --- | ---: | ---: | ---: | ---: |
| app-shell | 3 | 3 | 0 | 100% |
| device | 3 | 3 | 0 | 100% |
| organisation | 14 | 14 | 0 | 100% |
| user | 11 | 11 | 0 | 100% |
| ui kit | 2 | 2 | 2 | 100% |
| all | 33 | 33 | 2 | 100% |

### Unmarked

None.

### Ignored

```text
packages/ui/src/components/ui/alert-dialog.tsx:143: Button — rendered by Close with the anchor given to AlertDialogCancel
packages/ui/src/components/ui/sheet.tsx:65: Button — no screen renders a sheet yet; the first one anchors it
```

## Screens

| Screen | Anchors | Scenarios |
| --- | ---: | ---: |
| app-shell | 9 | 13 |
| device | 10 | 2 |
| user.profile | 10 | 14 |
| organisation | 30 | 4 |
| user.sign-in | 8 | 8 |

<!-- coverage:end -->

## How it is counted

The numbers are an indicator for the people and the models who move the code onto the
contract, read from the source text. They are not a rule of the contract: nothing fails
when they drop, and the contract check (`bun run contract:check:sources`) remains what keeps
the anchors of the code and of the screen files equal.

- **Model.** Each entity of `model.schema.json`, its fields (`properties`) and its actions
  (`x-perch.actions`), each with the anchors whose `binding`, alone or in a list, names it:
  `model: <entity>.<field>` or `action: <entity>.<action>`. A field or an action no anchor
  binds is `unbound`. That is a report, not a rule: a field may be internal, such as an id
  or a creation time, and an action may run outside the screens.
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
  attributes, and its element still counts. An element inside
  a marked control that has no `onClick` of its own (an icon or a button inside a marked
  link) is a part of that control and is not counted again.
- **Marked.** A control is marked when it carries `data-testid`, `testId` or a `*TestId`
  prop, whatever the value (a literal, a prop or a constant), or when it sits inside a
  `<label>`, which names it for a locator. Whether the value is an anchor the contract
  declares is the sources check's business, not this count's.
- **Ignored.** A control that is not a test target is declared so in the source, with a
  reason, by a comment right before its element, with only white space between: in code the
  line comment `// ui-contract-ignore: <reason>`, among JSX children
  `{/* ui-contract-ignore: <reason> */}`. `ui-contract-ignore` covers the element and
  everything inside it, `ui-contract-ignore-self` the element alone. An ignored control is
  neither marked nor unmarked, whatever it carries (an anchor, a `<label>` around it), and
  is listed with its reason; the elements inside it are not taken as its parts. A marker
  whose own reason is shorter than three characters, written in another form, or not right
  before an element is a problem: the command prints it and writes nothing.
- **Unmarked.** The controls that are neither marked nor ignored, listed as
  `file:line: <element>`, the element's tag with its `aria-label` or its text when that is a
  static string. `bun run contract:coverage --unmarked` prints the same two lists.
- **Share.** Marked controls over controls, the ignored ones left out, rounded; `-` for a
  module without controls.
- **Screens.** The anchors a screen declares in its screen file, and the scenarios whose
  text (`where`, `scenario`, `steps`, `expected`) names one of its anchors, an anchor derived
  from one of them, or the path of one of its bindings. The frame (`app-shell`) is reached
  by every scenario that waits for its status.
