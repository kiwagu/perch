# UI kit (`@workspace/ui`)

## Role in the architecture

The visual primitives every view is built from: shadcn components on Base UI with
Tailwind CSS v4, mobile first. The package holds no text, no translations and no domain
knowledge; copy and data arrive through props. Dark colors follow the system setting.

## Key exports

- `./components/ui/*`: shadcn primitives (button, card, input, label, field, alert, separator,
  dropdown-menu, select, sheet). Add more with `bunx shadcn add <name>` in this folder; the
  file then belongs to us and is edited in place.
- `./components/platform/*`: props-driven building blocks of the application shell.
- `./lib/utils`: `cn` for class names.
- `./styles/global.css`: Tailwind, the theme tokens and the base layer; import it once in the app.

## Commands

- `bun run test`: component tests (jsdom).
- `bun run typecheck`, `bun run lint`.
