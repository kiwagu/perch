# UI kit (`@workspace/ui`)

## Role in the architecture

The visual primitives every view is built from: shadcn components on Base UI with
Tailwind CSS v4, mobile first. The package holds no text, no translations and no domain
knowledge; copy and data arrive through props. The dark colors apply while `<html>` carries
the class `dark` (the `dark:` variant follows it), which the app sets for its theme.
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
  alert-dialog, separator, dropdown-menu, select, sheet). `Alert` is a message on the card: its
  `variant` `default` keeps it plain with a muted description, and a tone (`success`,
  `warning`, `info` or `destructive`) paints its title, description and icon in that tone.
  `Form` is a form whose `onSubmit` returns whether it saved; on `true` each of its own fields
  takes the value it held when the submit started as saved (what was typed during the save
  stays unsaved), and the default submit is always prevented. Add more with
  `bunx shadcn add <name>` in this folder, or copy what `bunx shadcn view <name>` prints when
  `add` cannot resolve an alias; the file then belongs to us and is edited in place. `toast` is
  the kit's own:
  `Toaster`, the polite live region (`role="status"`, each addition announced alone) around the
  list the app's toasts stack in, centred at the top, in the order given, and `Toast`, one toast
  carrying its `data-code` and its `tone` (`success`, `warning` or `error`: the theme's
  `success`, `warning` and `destructive`, with an icon each), dismissed by a click on it or its
  cross; the app owns the list and how long each stays.
- `./components/platform/*`: props-driven building blocks of the application shell.
  - `AppShell`: the page frame (brand, actions, status, the navigation as a bottom bar on
    small screens and a side rail from `lg`); `navigationTestId` is the anchor of its
    `<nav>`. Without `navigation` it renders no `<nav>`, and the page takes the whole width
    with no room kept for the bar.
  - `OptionSelect`: a labelled choice between a few options; `testId` marks the trigger, and
    each option carries the derived `<testId>.option` with its value as `data-value`.
  - `ConfirmDialog`: a modal question with one action and a way back (`title`,
    `description`, `confirmLabel`, `cancelLabel`, `destructive`, `onConfirm`, `onCancel`);
    `testId` marks the dialog, with `code` as its `data-code`, and its buttons carry
    `<testId>.confirm-button` and `<testId>.cancel-button`.
  - `PasswordInput`: a password input with its eye beside it (`showLabel`, `hideLabel` for its
    accessible name), which shows what the input holds as typed or hides it again; `testId`
    marks the input, and the eye carries the derived `<testId>.visibility-button` with `show`
    or `hide` as its `data-value`, what a click does. Whether the input shows its value is its
    own, never a flow's: the eye is always enabled, the input disabled or not.
  - `navItemVariants`: the classes of a navigation item, active or not.
- `./unsaved-input`: whether the fields of a page hold input the user typed and no action
  took yet. `UnsavedInputScope` collects what the fields inside report, `useUnsavedInput()`
  says whether any holds unsaved input now (whoever guards a leave reads it; false outside a
  scope), `useUnsavedFields()` gives a reader that tells, when called, which fields do by the
  anchors they render and whether one renders none (a leave that carries some fields asks only
  for the others; two fields of one anchor stay two), and `useTracksInput` is what a field
  component uses to track itself against the last value the app gave it, reporting its anchor
  (an `Input` or `Textarea` its `data-testid`, a `Select` its `anchor`, which `OptionSelect`
  sets to its `testId`, since the trigger carries the anchor and the root tracks). `FormScopeContext` lets a form capture what its fields hold when
  a submit starts and mark those values saved when it saved. `Input`, `Textarea`, `Select` and `OptionSelect` track themselves: each is unsaved
  while its value differs from the last value the app gave it (the `value` prop whenever it
  did not come from the field's own last change, or the `defaultValue` at mount; a select
  compares its choices, one or several, as it compares an item, `isItemEqualToValue` or
  `Object.is`), and takes `holdsInput={false}` for a choice that applies at once.
- `./lib/utils`: `cn` for class names.
- `./styles/global.css`: Tailwind, the theme tokens (shadcn's, plus the tones `success`,
  `warning` and `info` beside its `destructive`) and the base layer; import it once in the app.
  It points Tailwind at the kit's components, so their classes are generated in apps. The base
  layer also hides the native scrollbar of a Base UI list (`.base-ui-disable-scrollbar`): the
  kit's components render no inline `<style>`, which a strict style policy refuses (`Select`
  keeps its popup under Base UI's `CSPProvider` with `disableStyleElements`). A text in a tone
  reads at 4.5:1 or more on the card and the background in both themes, which
  `src/styles/global.spec.ts` holds (light: Tailwind's green-700, amber-700, blue-700 and
  red-700; dark: green-400, orange-400, blue-400 and red-400). Which tone a message takes:
  - `success`: an outcome that went through (saved, sent, removed).
  - `warning`: a caution or a degraded state (offline, slow, about to expire).
  - `info`: neutral information worth noticing (a new version, a link on its way).
  - `destructive`: an error or a failure.
  - A requirement not met yet while the user types (a password rule) is no error: it stays
    `muted-foreground`, never red.

## Commands

- `bun run test`: component tests (jsdom).
- `bun run typecheck`, `bun run lint`.
