# UI kit (`@workspace/ui`)

## Role in the architecture

The visual primitives every view is built from: shadcn components on Base UI with
Tailwind CSS v4, mobile first. The package holds no text, no translations and no domain
knowledge; copy and data arrive through props. Dark colors follow the system setting. A
composite takes its anchor (`data-testid`) as a `testId` prop and builds the anchors of the
parts it renders itself with `testIdFor(testId, '<suffix>')` from
`@workspace/ui-contract/anchors`, the only dependency on the UI contract.

## Key exports

- `./components/ui/*`: shadcn primitives (button, card, input, textarea, label, field, alert,
  alert-dialog, separator, dropdown-menu, select, sheet). Add more with `bunx shadcn add <name>`
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
- `./lib/utils`: `cn` for class names.
- `./styles/global.css`: Tailwind, the theme tokens and the base layer; import it once in the
  app. It points Tailwind at the kit's components, so their classes are generated in apps.

## Commands

- `bun run test`: component tests (jsdom).
- `bun run typecheck`, `bun run lint`.
