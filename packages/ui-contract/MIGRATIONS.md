# Contract versions and their migrations

A contract declares the version of the format it is written in: `version` in
`contract/domain/platform.yaml`. The engine reads every version from 1 up to its own,
`CONTRACT_VERSION`, each by the rules of that version. A rule a version brings applies from that
version on (`since(contract, N)` in `src/check/editions.ts`), so a contract at an older version
loads and checks as it did before. `bun run contract:check` passes an older contract and says so
in one line, `ui-contract check --current` fails on it, and a version newer than the engine's is
a problem.

`bun run contract:migrate` prints the steps from the declared version to the engine's,
`N -> N+1: <note>`, each with the files it changes and the work it leaves by hand.
`bun run contract:migrate --write` rewrites those files. A YAML file is edited through its
document and written back into its own text: only the nodes a step edits change (a scalar in
place, a pair or an item by its lines), and every other byte stays as written, spacing, quotes
and comments included; a second run finds nothing to do. The check and the loader never migrate.

A new version comes with its step: a `Migration` in `src/files/migrations/`, named by the two
versions in words (`one-to-two.ts`), added to `MIGRATIONS` (`src/files/migrations/registry.ts`),
`CONTRACT_VERSION` raised, and a heading below.

## Version 1

The first format. `platform.yaml` declares `version: 1`, and the vocabulary repeats it in its
`Contract version: 1` line, which the check wants there and equal to it. No step leads here.

## Version 2

- What changed: the version is said once, in `platform.yaml`. From version 2 the check refuses
  the vocabulary's `Contract version` line.
- Why: the engine picks the rules it reads a contract by from that one number, so a second copy
  of it could only disagree with the first.
- What `contract:migrate --write` does: removes the vocabulary's `Contract version: 1` line with
  the blank line after it, and sets `version: 2` in `platform.yaml`.
- What is left by hand: nothing.

## Version 3

- What changed: a code of a platform action concerns the parameters it is attributed to, the one
  it is named after (`<parameter>-<suffix>`) and each one whose `codes` list it, and an error
  derives the field it shows the code under, as it does for a code of the model. A written
  `fields` merges over the derived one, code by code, and may name `form`, the form as a whole.
  From version 3 the check wants every string parameter bounded, every code of a field attributed
  to a parameter whose value has the constraint the code names, every parameter's `codes` among
  its action's, every code two fields pass written in `fields`, and no written entry the engine
  derives.
- Why: a code two controls passed was dropped silently, a written `fields` hid every derived
  entry, and a platform code showed under no field at all.
- What `contract:migrate --write` does: sets `version: 3` in `platform.yaml`, nothing else.
- What is left by hand: declare `values` and refer every string parameter; attribute every
  field-shaped code; write `form` or a field for each code two fields share; drop written
  `fields` the engine derives.
