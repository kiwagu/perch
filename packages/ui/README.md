# UI kit (`@workspace/ui`)

## Role in the architecture

The visual primitives every view is built from: shadcn components on Base UI with
Tailwind CSS v4, mobile first. The package holds no text, no translations and no domain
knowledge; copy and data arrive through props. Dark colors follow the system setting.
Every primitive spreads its props onto its element, so a call site passes `data-testid` and
the other contract attributes directly. A composite takes its anchor (`data-testid`) as a
`testId` prop and builds the anchors of the parts it renders itself with
`testIdFor(testId, '<suffix>')` from `@workspace/ui-contract/anchors`, the only dependency
on the UI contract; a part with a screen-level name of its own is a named prop
(`navigationTestId`). The anchor goes on the semantic element, the dialog's own box rather
than its portal or overlay. A control that is not a test target carries a
`// ui-contract-ignore-self: <reason>` marker right before it, as the inner buttons of
`AlertDialogCancel` and of the sheet's close do.

## Key exports

- `./components/ui/*`: shadcn primitives (button, card, input, textarea, label, field, alert,
  alert-dialog, separator, dropdown-menu, select, sheet), and `Form`: a form whose `onSubmit`
  returns whether it saved; on `true` its own fields hold no unsaved input, and the default
  submit is always prevented. Add more with `bunx shadcn add <name>`
  in this folder, or copy what `bunx shadcn view <name>` prints when `add` cannot resolve an
  alias; the file then belongs to us and is edited in place.
- `./components/platform/*`: props-driven building blocks of the application shell.
  - `AppShell`: the page frame (brand, actions, status, the navigation as a bottom bar on
    small screens and a side rail from `lg`); `navigationTestId` is the anchor of its
    `<nav>`.
  - `OptionSelect`: a labelled choice between a few options; `testId` marks the trigger, and
    each option carries the derived `<testId>.option` with its value as `data-value`.
  - `ConfirmDialog`: a modal question with one action and a way back (`title`,
    `description`, `confirmLabel`, `cancelLabel`, `destructive`, `onConfirm`, `onCancel`);
    `testId` marks the dialog, with `code` as its `data-code`, and its buttons carry
    `<testId>.confirm-button` and `<testId>.cancel-button`.
  - `navItemVariants`: the classes of a navigation item, active or not.
- `./unsaved-input`: whether the fields of a page hold input the user typed and no action
  took yet. `UnsavedInputScope` collects what the fields inside report, `useUnsavedInput()`
  says whether any holds unsaved input now (whoever guards a leave reads it; false outside a
  scope), and `useTracksInput` is what a field component uses to track itself against the
  last value the app gave it. `FormScopeContext` lets a form tell its fields a submit saved
  them. `Input`, `Textarea`, `Select` and `OptionSelect` track themselves: each is unsaved
  while its value differs from the last value the app gave it (the `value` prop whenever it
  did not come from the field's own last change, or the `defaultValue` at mount), and takes
  `holdsInput={false}` for a choice that applies at once.
- `./lib/utils`: `cn` for class names.
- `./styles/global.css`: Tailwind, the theme tokens and the base layer; import it once in the
  app. It points Tailwind at the kit's components, so their classes are generated in apps.

## Commands

- `bun run test`: component tests (jsdom).
- `bun run typecheck`, `bun run lint`.
