# Translations (`@workspace/i18n`)

## Role in the architecture

User-visible text for the presentation layer. Catalogs are flat JSON files next to each
feature (`<feature>.en.json`, `<feature>.es.json`) with greppable keys such as
`user.profile.save`; code names a key only as a literal so a plain text search finds both
the catalog entry and every use. English is the complete base catalog; Spanish may lag.

## Key exports

- `createTranslator(catalogs, locale)`: `t(key, params?)` with `{name}` parameters, plural
  forms `<key>.one` / `<key>.other` chosen by `Intl.PluralRules`, and the fallback
  Spanish → English → the key itself.
- `I18nProvider`, `useT()`, `useLocale()`; `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `matchLocale(tag)`.
- `createFormats(locale, timeZone?)` and `useFormats()`: how the app writes what the user reads
  that is not a sentence, on `Intl`: `date` ("Oct 29, 2026"), `dateTime` (with the time),
  `number` (the locale's digits and separators) and `relative` (how long ago or ahead a moment
  is, in the largest whole unit: "3 minutes ago", "yesterday"). Moments are written in the
  provider's `timeZone` (an IANA name), or the runtime's own when it has none. Views take them
  from `useFormats()`, never from an `Intl` formatter of their own.
- `./translator`: the translator alone (`createTranslator`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`,
  `matchLocale` and their types), without React, for code that writes text outside a page (a
  server's mails).
- `./check` `checkI18n(root)` and the CLI `i18n-check [--root <dir>]`: fails on a key missing in
  English, an English key nothing uses, or a non-literal `t()` argument; lists keys missing in
  Spanish without failing.

## Commands

- `bun run test`: translator, formats, provider (jsdom) and key-check tests.
- `bun run typecheck`, `bun run lint`.
