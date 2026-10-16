# E2E tests (`@workspace/e2e`)

## Role in the architecture

End-to-end tests of the web application in a real browser, on two Playwright projects:
`mobile` (Pixel 7) first, then `desktop` (1280x800). Each test pairs by name with an
instruction spec in `specs/`; after every step a check fails the test when the page
scrolls sideways. Each test signs up a fresh account in a fresh browser context, with
data generated from the seed catalog. Key pages are compared with screenshots on `mobile`;
the baselines are not committed: the first run on a machine writes them, later runs
compare against them.
The stand is the mcproc `e2e` profile (`surrealdb-e2e` and the `web-e2e` dev server on
127.0.0.1:5190), not Playwright's web server, so `mcproc logs e2e` shows what a run saw.

## Key exports

None; tests only. `specs/<feature>/*.md` are the specs, `src/<feature>/*.e2e.spec.ts`
the tests, `src/support/fixtures.ts` the `test` with the `signedIn` fixture and the
step check, `src/support/data.ts` the generators.

## Commands

- `bun run test:e2e` (repository root): builds the dependencies through turbo, starts and
  waits for the `e2e` profile, then runs Playwright; extra arguments go to Playwright
  (`--grep @smoke`, `--update-snapshots=missing`). `CI=1` runs one worker.
- `bun run test:e2e --down`: stops the `e2e` profile.
- `bun run typecheck`, `bun run lint`.
