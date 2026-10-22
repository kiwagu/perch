# E2E specs (`@workspace/e2e-spec`)

## Role in the architecture

Tooling for the instruction-style e2e scenarios. Each scenario is one Markdown file,
`tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md`, a short instruction a person could
follow by hand: a YAML front matter with `tags`, `devices` (the role each device acts as) and
`data`, then the title, where it starts, the scenario in one sentence, the steps and the
expected results. Its text names the user interface through bracket references that
`bun run contract:check` resolves against the contract: `[<anchor>]` (a declared anchor or a
derived one), `[/path]` (the path of a binding), `[code:<code>]`, `[state:<state>]` and
`[value:<value>]`. Each scenario pairs by its id, the file's path without `.md`, with a
Playwright test at the same path under `tests/e2e/src`: `user/base/sign-up` with
`tests/e2e/src/user/base/sign-up.e2e.spec.ts`, whose first line is
`// scenario: user/base/sign-up`. The files are parsed by `loadScenarios` of
`@workspace/ui-contract`, which the contract check and the manifest share; this package
turns a scenario into a failing test skeleton and checks that scenarios and tests stay in
step.

## Key exports

- `readScenarios(root)`: the scenarios of the repository at `root` (the files of
  `tests/e2e/scenarios`), read through `loadScenarios` of `@workspace/ui-contract`, with the
  problems of the files as `file:line: message`.
- `scaffoldTest(scenario, { scenarioId })`: a test that starts with `// scenario: <id>`, with
  one `test.step` per step and one failing `expect.soft` per expected result; the fixtures
  `{ page }` for a single `guest` device, `{ page, signedIn }` otherwise; `generate.<name>()`
  for a `generate` datum, the value itself for a fixed one; the support files imported from
  the depth of the id. `testPathFor(testsDir, id)` names its file.
- `checkCoverage(root, testsDir)`: scenarios without tests, tests without scenarios,
  tests whose first line does not name their scenario, tests with fewer `test.step(...)` calls
  in their code than their scenario has steps (a static count: comments do not count,
  unreachable calls would), and the problems of the scenario files.

## Commands

- `bun run e2e:scaffold <entity>/<layer>/[<area>/]<slug>` (repository root): writes
  `tests/e2e/src/<id>.e2e.spec.ts` from the scenario with that id, never over an existing
  file.
- `bun run e2e:coverage`: the pairing check (`--root=. --tests=tests/e2e/src`), part of
  `bun run check`.
- `bun run test`, `bun run typecheck`, `bun run lint`.
