# E2E tests (`@workspace/e2e`)

## Role in the architecture

End-to-end tests of the web application in a real browser, on two Playwright projects:
`mobile` (Pixel 7) first, then `desktop` (1280x800). Each test pairs by name with an
instruction spec in `specs/`; after every step a check fails the test when any open page
scrolls sideways. Each test signs up fresh accounts in fresh browser contexts, with
data generated from the seed catalog. Key pages are compared with screenshots on `mobile`;
the baselines are not committed: the first run on a machine writes them, later runs
compare against them.
The stand is the mcproc `e2e` profile (`surrealdb-e2e`, `gateway-e2e` and the `caddy-e2e`
front), not Playwright's web server, so `mcproc logs e2e` shows what a run saw. Tests open the
front, https://localhost:5493, which serves the web app's production build (`apps/web/dist`,
written by the launcher before each run; no dev server) and, under `/backend/`, the gateway
on one origin.

Specs are tagged `@smoke` (`user/`: sign up, rename) or `@full` (`sync/`: the slower specs
of one account on several devices; `organisation/`: two accounts, each in a browser of its
own):

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
- `organisation/01-shared-notes`: user A creates an organisation and invites user B; B sees
  it and A's note without a reload, B's note reaches A within 5 seconds, and B sees neither
  the members nor A's profile.
- `organisation/02-outsider`: an account that was not invited sees no organisation and no
  notes, and its own organisation shows none of the other's.
- `organisation/03-membership-change`: an invitation reaches B's open page within 5 seconds;
  a removal takes the organisation away within 5 seconds and deletes it from the device.

Four specs write measurements into the test's annotations, shown in the HTML report:
`sync-latency-ms` (from the click on device B to the new name on device A),
`idle-frames-per-minute`, `note-sync-latency-ms` (from the click on "Add note" on device B to
the note on device A) and `membership-change-ms` (from the click on "Invite" on device A to
the organisation and its note on device B).

## Key exports

None; tests only. `specs/<feature>/*.md` are the specs, `src/<feature>/*.e2e.spec.ts`
the tests. `src/support/fixtures.ts`: the `test` with the step check and its fixtures,
`signedIn` (device A, signed up on `/me`), `secondDevice` (device B, a browser context of
its own that opens and signs in with the same account when a test asks) and `anotherAccount`
(another user: a fresh account signed up in a browser context of its own, on `/me`),
`appReady`, `signIn` and `signUp`. `src/support/network.ts`: `SyncNetwork`, which routes a
page's sync socket through the test so it can go offline and back (Playwright's offline mode
leaves an open WebSocket up). `src/support/data.ts`: the generators (accounts, names, bios,
organisation keys and names, note texts).

## Commands

- `bun run test:e2e` (repository root): builds the dependencies and the web app's production
  build through turbo (and stops when `apps/web/dist/index.html` is missing afterwards), starts
  the `e2e` profile with `--reload` (apps already online restart: the database is empty, the
  gateway and the front run the current code and configuration) and waits for it, then runs
  Playwright; extra arguments go to Playwright (`--grep @smoke`, `sync/`,
  `--update-snapshots=missing`). `CI=1` runs one worker.
- `bun run test:e2e --down`: stops the `e2e` profile.
- `bun run typecheck`, `bun run lint`.
