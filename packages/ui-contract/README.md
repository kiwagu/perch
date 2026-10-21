# UI contract (`@workspace/ui-contract`)

## Role in the architecture

The contract between the user interface and everything that drives it: tests, agents and
the people who model screens. It holds the anchor grammar every `data-testid` follows
(2 to 5 dot-separated kebab-case segments: the screen name first, the kind last, as in
`user.sign-in.email-input`) and the tooling around the `contract/` folder at the root. The
`./anchors` subpath is pure and browser-safe, so views and the UI kit may import it; the
root export is build-time tooling for Bun.

## Key exports

- `.`: the tooling; today it re-exports `./anchors`.
- `./anchors`: the browser-safe helpers. `ANCHOR_PATTERN`, `isAnchor(text)`,
  `segmentsOf(anchor)`, `kindOf(anchor)` (the last dash-separated word of the last segment),
  `screenOf(anchor, screenNames)` (the longest screen name on segment boundaries);
  `testIdFor(base, suffix)`, the only way to build a derived anchor `<base>.<suffix>`,
  `baseOf(anchor, suffixes)`, `isKnownAnchor(anchor, declared, suffixes)`; `CONTRACT_VERSION`.

## Commands

- `bun run test`: the anchor grammar and derived-anchor tests.
- `bun run typecheck`, `bun run lint`.
- From the root: `bun run contract:check` (the contract files against their schemas and
  each other), `bun run contract:schemas` (the JSON Schemas of the contract files),
  `bun run contract:manifest` (`ui-manifest/manifest.json` from the contract),
  `bun run contract:diff <ref>` (the contract changes since a git ref, for a hand-over) and
  `bun run contract:coverage` (how many controls carry an anchor, per module and screen).
