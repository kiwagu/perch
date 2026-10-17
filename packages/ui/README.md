# UI kit (`@workspace/ui`)

## Role in the architecture

The visual primitives every view is built from: shadcn components on Base UI with
Tailwind CSS v4, mobile first. The package holds no text, no translations and no domain
knowledge; copy and data arrive through props. Dark colors follow the system setting.

## Key exports

- `./components/ui/*`: shadcn primitives (button, card, input, textarea, label, field, alert,
  alert-dialog, separator, dropdown-menu, select, sheet). Add more with `bunx shadcn add <name>`
  in this folder, or copy what `bunx shadcn view <name>` prints when `add` cannot resolve an
  alias; the file then belongs to us and is edited in place.
- `./components/platform/*`: props-driven building blocks of the application shell.
- `./lib/utils`: `cn` for class names.
- `./styles/global.css`: Tailwind, the theme tokens and the base layer; import it once in the
  app. It points Tailwind at the kit's components, so their classes are generated in apps.

## Commands

- `bun run test`: component tests (jsdom).
- `bun run typecheck`, `bun run lint`.
