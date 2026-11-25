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
and comments included; the model, JSON, is edited as text, a member dropped with its comma and
every other byte kept; a second run finds nothing to do. The check and the loader never migrate.

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

## Version 4

- What changed: what an element's kind implies is derived: a select's `dataValue` and `option`, a
  secret input's `visibility-button`, the `confirm-button` and `cancel-button` of a dialog and a
  confirmation. So is the `roles` of a link bound to one route, which takes those of the route when
  the route admits fewer devices than the link's screen serves (the frame serves every role); roles
  are compared by the devices they admit, so `[identity, member, admin]` and `[identity]` are the
  same. So are the guards of a password pair: a secret input that writes `confirms: <the new
  password input>` makes the two a pair, and the loader derives `passwordBreaksRules`,
  `passwordsDiffer`, `confirmationStrays` and `confirmationFollows` wherever its flow names them;
  the confirmation takes the value of the input it confirms. So is the search parameter of a
  mail's link: the screen a platform action's `mail.link` opens gets, on every route, the
  parameter its `search` names, from the platform value of that name, as the screen's key
  (`x-perch.key`: the first code of the parameter its landing action takes it into). From version
  4 a screen file never writes what is derived, and the check refuses it.
- Why: every select, secret input, dialog and confirmation wrote the same lines, a link wrote
  the roles its route already serves, every form setting a new password wrote the same four
  guard sentences, its confirmation limited by nothing, and every screen a mail links to wrote
  the token's parameter again, in its own words.
- What `contract:migrate --write` does: sets `version: 4` in `platform.yaml` and drops from the
  screen files what version 4 derives. From an anchor: a select's `dataValue: true` and `option`,
  a secret input's `visibility-button`, the two answers of a dialog or a confirmation (a
  `derived` left empty goes with its key). From a link: the `roles` that admit what its route's
  admit, where the loader derives them. From the routes of a screen a mail links to: the
  parameter that mail names, when it holds what the platform value does and writes nothing the
  derived one lacks, and the `search` it leaves empty. On a screen whose flow declares the guards
  of a password pair and that holds exactly one secret input with a composite and exactly one
  other secret input with no binding: `confirms: <the input with the composite>` on the second,
  and the four guards gone. A second run finds nothing to do.
- What is left by hand: what it cannot decide, each named with its file. A select's `dataValue`
  that is not `true`. A screen that declares the pair's guards and has no one confirmation to
  tell, or one of the four names that is not a sentence: write `confirms` on the confirmation and
  drop the guards. A mail's parameter that differs from the platform value's (the type, `enum`,
  bounds or `pattern`), or that writes a `default` or the controls of its page (`x-perch.control`,
  `x-perch.values`), which the derived parameter lacks and a screen's key may not have: decide
  by hand, then drop it. A mail whose `search` names no value a route can take. And always: write
  `x-perch.key: <code>` on a search parameter that is the screen's key, where no `mail.link`
  derives it.

## Version 5

- What changed: the success of a button's region clears its area's error. The region of a
  button bound to one action, derived or written `by: <button>`, gets `clear: <part>.error` as
  the first effect of every branch of its `onDone` that neither shows nor clears that error, when
  the screen declares `<part>.error`. From version 5 a screen file never writes that clear in such
  a branch, and the check refuses it. A region written in full and a clear of another anchor are
  the screen's, as before.
- Why: a region showed a refusal on its error and never forgot it, so a refused action's error
  stayed after the next success, and the app forgot it on its own, which no flow said.
- What `contract:migrate --write` does: sets `version: 5` in `platform.yaml`, and drops from a
  region written `by: <button>` whose part has its error the `clear: <part>.error` that a branch
  of its `onDone` writes first (in either form), with the branch's `actions` when it held nothing
  else. A second run finds nothing to do.
- What is left by hand: a `clear: <part>.error` written after another effect of such a branch,
  named with its file and its place: version 5 refuses it, and dropping it moves the clear first.

## Version 6

- What changed: the platform may declare a default length, `defaults: { maxLength: <n> }`. Every
  value that names no limit and would take one, a value of `platform.values`, a field of the
  model or a parameter of a platform action that refers to no `value` and writes a constraint,
  with `type: string`, no `enum` and not read-only, takes it as the files load, before
  anything is derived, so every reader (what a parameter and a field take, a field's
  `<field>-too-long`, the keywords beside `value`, the manifest) takes the resolved value. A value
  of `platform.values` may write `maxLength: null`: no limit, and it takes no default. From
  version 6 the loader refuses a written `maxLength` equal to the default on a value that would
  take it, and a `null` on one that would take none (no `defaults`, no string, or an `enum`). A
  route's search parameter never takes the default. Before version 6 a written `defaults` is
  read and takes no effect, and a `null` says what no limit says.
  From version 6 a platform action also writes its `codes` as a map, each code with when it
  answers (`<code>: <condition>`, or `{ invariant: <name> }` for a rule several actions keep),
  and a `result` of one string keeps the budget of a description, 200 characters, as each line of
  a list does: the check refuses a list of codes and a longer string. Before version 6 both load
  as they did.
- Why: the same limit (a name of 80 characters) was written on every value that has it, so a
  change of it had to be made in every place; a default with an override where a value needs
  another says it once.
  A list of codes said no condition, so when each answered lived in one free `result` string
  that grew without a budget; the map says it per code, and a rule several actions keep once.
- What `contract:migrate --write` does: sets `version: 6` in `platform.yaml`, and where the
  platform declares `defaults`, keeps every value at the limit it had, but for the fields and
  parameters left by hand below: drops a `maxLength` equal to the default from each value of
  `platform.values` and each field of the model that would take it, and writes `maxLength: null`
  on each value of `platform.values` that would take it and names no limit, before its `pattern`,
  `description` or `examples`. A limit of another number, one on a value the default never
  reaches and every value of a contract with no `defaults` stay as written. To state a default,
  write `defaults` in `platform.yaml` before running the step.
- What is left by hand: each field of the model that would take the default and names no limit,
  named with its file and its place. Its JSON Schema allows no `null`, so it takes the default
  from version 6: write its own `maxLength` where that is too short. The same goes for each
  parameter of a platform action that refers to no `value`, is a string with no `enum`, writes a
  constraint (a `minLength`, a `pattern`) and no `maxLength`, named with its file, its path and the
  default it takes. It cannot say `null` either, and the step leaves it as written, so the request
  it takes would be bounded from version 6: write its own `maxLength` where that is too short, or
  refer to a named value (`value: <name>`) that writes `maxLength: null`, which the parameter then
  takes (a parameter may only narrow its value).
  The step also names each action that writes its codes as a list and each `result` of one
  string past 200 characters, with its path: write when each code answers, and the result as
  outcome lines within the budget, a refusal as its code's condition. Only the author knows the
  conditions, so the step writes none.
