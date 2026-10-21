# Contract coverage

How far the contract reaches into the code: how many of the controls a user can act on
carry an anchor, per feature module of the web app and for the UI kit, and how many anchors
and scenarios each screen has. `bun run contract:coverage --write` rewrites the block below
from the code and the contract; the text around it is written by hand.

<!-- coverage:start -->

The contract declares 5 screens, 67 anchors and 29 codes.

| Module | Controls | Marked | Share |
| --- | ---: | ---: | ---: |
| app-shell | 3 | 3 | 100% |
| device | 3 | 3 | 100% |
| organisation | 14 | 14 | 100% |
| user | 11 | 11 | 100% |
| ui kit | 4 | 2 | 50% |
| all | 35 | 33 | 94% |

| Screen | Anchors | Scenarios |
| --- | ---: | ---: |
| app-shell | 9 | 13 |
| user.sign-in | 8 | 8 |
| user.profile | 10 | 14 |
| organisation | 30 | 4 |
| device | 10 | 2 |

<!-- coverage:end -->

## How it is counted

The numbers are an indicator for the people and the models who move the code onto the
contract, read from the source text. They are not a rule of the contract: nothing fails
when they drop, and the contract check (`bun run contract:check:sources`) remains what keeps
the anchors of the code and of `screens.json` equal.

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
- **Share.** Marked controls over controls, rounded; `-` for a module without controls.
- **Screens.** The anchors a screen declares in `screens.json`, and the scenarios whose
  text (`where`, `scenario`, `steps`, `expected`) names one of its anchors, an anchor derived
  from one of them, or the path of one of its bindings. The frame (`app-shell`) is reached
  by every scenario that waits for its status.
