# Not found (module `not-found`)

## Role in the architecture

The page an address no other route takes opens: it says no page is there and offers one way
back, to sign in for a guest, to the profile for a signed-in account. It holds no data and no
service; `presentation/` holds the page (its container reads whether someone is signed in from
the session), its view and the i18n catalogs.

## Surface

- Route: `/$`, the router's splat, which every other route outranks; no guard, for anyone.
- No shapes, commands or providers.
- i18n namespace `not-found.*` (`presentation/i18n/not-found.en.json`, `not-found.es.json`).
- Anchors: screen `not-found` in `contract/domain/screens/$.yaml`.

## Commands

- `bun run test` in `apps/web` runs its specs (`not-found.module.spec.ts`,
  `not-found.view.spec.tsx`).
