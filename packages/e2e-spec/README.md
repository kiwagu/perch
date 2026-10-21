# E2E specs (`@workspace/e2e-spec`)

## Role in the architecture

Tooling for instruction-style e2e scenarios. The scenarios live in the contract:
`contract/screens.json` under `scenarios`, each a short instruction a person could follow by
hand (title, tags, the role of each device, where it starts, test data, the scenario in one
sentence, steps, expected results). Their text names the user interface through bracket
references that `bun run contract:check` resolves against the contract: `[<anchor>]` (a
declared anchor or a derived one), `[/path]` (the path of a binding), `[code:<code>]`,
`[state:<state>]` and `[value:<value>]`. Each scenario pairs by its id with a Playwright test:
`user/01-sign-up` with `tests/e2e/src/user/01-sign-up.e2e.spec.ts`, whose first line is
`// scenario: user/01-sign-up`. The tooling turns a scenario into a failing test skeleton and
checks that scenarios and tests stay in step.

## Key exports

- `readScenarios(screensPath)`: the scenarios of a `contract/screens.json`, read through
  `loadScreens` of `@workspace/ui-contract`, with the problems of the file as
  `file:line: message`.
- `scaffoldTest(scenario, { scenarioId })`: a test that starts with `// scenario: <id>`, with
  one `test.step` per step and one failing `expect.soft` per expected result; the fixtures
  `{ page }` for a single `guest` device, `{ page, signedIn }` otherwise; `generate.<name>()`
  for a `generate` datum, the value itself for a fixed one. `testPathFor(testsDir, id)` names
  its file.
- `checkCoverage(screensPath, testsDir)`: scenarios without tests, tests without scenarios,
  tests whose first line does not name their scenario, tests with fewer `test.step(...)` calls
  in their code than their scenario has steps (a static count: comments do not count,
  unreachable calls would), and the problems of the screens file.

## Commands

- `bun run e2e:scaffold <feature>/<nn>-<slug>` (repository root): writes
  `tests/e2e/src/<feature>/<nn>-<slug>.e2e.spec.ts` from the scenario with that id, never over
  an existing file.
- `bun run e2e:coverage`: the pairing check (`--screens=contract/screens.json
  --tests=tests/e2e/src`), part of `bun run check`.
- `bun run test`, `bun run typecheck`, `bun run lint`.
