# E2E tests (`@workspace/e2e`)

## Role in the architecture

End-to-end tests of the web application in a real browser, on two Playwright projects:
`mobile` (Pixel 7) first, then `desktop` (1280x800). Each test pairs by name with an
instruction spec in `specs/`; after every step a check fails the test when any open page
scrolls sideways. Each test signs up a fresh account in a fresh browser context, with
data generated from the seed catalog. Key pages are compared with screenshots on `mobile`;
the baselines are not committed: the first run on a machine writes them, later runs
compare against them.
The stand is the mcproc `e2e` profile (`surrealdb-e2e`, `gateway-e2e`, the `web-e2e` dev
server and the `caddy-e2e` front), not Playwright's web server, so `mcproc logs e2e` shows
what a run saw. Tests open the front, https://localhost:5493, which serves the app and,
under `/backend/`, the gateway on one origin.

Specs are tagged `@smoke` (`user/`: sign up, rename) or `@full` (`sync/`: the slower specs
of one account on several devices):

- `sync/01-two-devices`: a bio written on device A reaches device B, which signs in after
  it; a name changed on B reaches A within 5 seconds.
- `sync/02-offline-edit`: B edits offline while A edits online; both changes meet once B
  is back.
- `sync/03-one-leader-per-browser`: two tabs of one browser share one sync leader; the
  other tab's edit reaches B, and it takes over within 2 seconds when the leader closes.
- `sync/04-sign-out`: signing out deletes the device's database and leaves B signed in;
  signing in again restores the profile from the server; an offline sign-out with an
  unsent change asks first.
- `sync/05-idle-traffic`: an idle visible tab, its clock driven by the test through 10
  minutes, sends at most 2 sync frames a minute.

Two specs write measurements into the test's annotations, shown in the HTML report:
`sync-latency-ms` (from the click on device B to the new name on device A) and
`idle-frames-per-minute`.

## Key exports

None; tests only. `specs/<feature>/*.md` are the specs, `src/<feature>/*.e2e.spec.ts`
the tests. `src/support/fixtures.ts`: the `test` with the step check and its fixtures,
`signedIn` (device A, signed up on `/me`) and `secondDevice` (device B, a browser context of
its own that opens and signs in with the same account when a test asks), `appReady` and
`signIn`. `src/support/network.ts`: `SyncNetwork`, which routes a page's sync socket through
the test so it can go offline and back (Playwright's offline mode leaves an open WebSocket
up). `src/support/data.ts`: the generators. `src/support/warm-up.ts`: the global setup, which
opens the app once so a fresh Vite dev server optimises its dependencies before the first test.

## Commands

- `bun run test:e2e` (repository root): builds the dependencies through turbo, starts and
  waits for the `e2e` profile, then runs Playwright; extra arguments go to Playwright
  (`--grep @smoke`, `sync/`, `--update-snapshots=missing`). `CI=1` runs one worker.
- `bun run test:e2e --down`: stops the `e2e` profile.
- `bun run typecheck`, `bun run lint`.
