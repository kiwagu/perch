# E2E specs (`@workspace/e2e-spec`)

## Role in the architecture

Tooling for instruction-style e2e specs: each scenario is a short Markdown document a
person could follow by hand (title, role, where, test data, scenario, steps, expected
result), paired by name with a Playwright test. The tooling turns a spec into a failing
test skeleton and checks that specs and tests stay in step.

## Key exports

- `parseSpec(markdown)`: the spec as data, or the problems found (fixed headings in any
  order; an unknown heading or a missing section is a problem).
- `scaffoldTest(spec, { specRelPath })`: a test with one `test.step` per spec step and
  one failing `expect.soft` per expected result; `testPathFor(specPath)` names its file.
- `checkCoverage(specsDir, testsDir)`: specs without tests, tests without specs, specs
  that do not parse, and tests with fewer `test.step(...)` calls in their code than their
  spec has steps (a static count: comments do not count, unreachable calls would).

## Commands

- `bun run e2e:scaffold tests/e2e/specs/<feature>/<nn>-<slug>.md` (repository root):
  writes `tests/e2e/src/<feature>/<nn>-<slug>.e2e.spec.ts`, never over an existing file.
- `bun run e2e:coverage`: the pairing check, part of `bun run check`.
- `bun run test`, `bun run typecheck`, `bun run lint`.
