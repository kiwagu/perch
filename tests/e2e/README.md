# E2E tests (`@workspace/e2e`)

## Role in the architecture

End-to-end tests of the web application in a real browser, on two Playwright projects:
`mobile` (Pixel 7) first, then `desktop` (1280x800). Each test pairs by id with an
instruction-style scenario of the contract, in `contract/screens.json` under `scenarios`: the
scenario `user/01-sign-up` with `src/user/01-sign-up.e2e.spec.ts`, whose first line is
`// scenario: user/01-sign-up` (`bun run e2e:coverage` checks the pairs); after every step a
check fails the test when any open page scrolls sideways. Each test signs up fresh accounts in
fresh browser contexts, with data generated from the seed catalog. Key pages are compared with screenshots on `mobile`;
the baselines are not committed: the first run on a machine writes them, later runs
compare against them; after an intended change of a page, `bun run test:e2e
--update-snapshots=changed` rewrites the ones that differ.
The stand is the mcproc `e2e` profile (`surrealdb-e2e`, `gateway-e2e` and the `caddy-e2e`
front), not Playwright's web server, so `mcproc logs e2e` shows what a run saw. Tests open the
front at `E2E_BASE_URL` (https://localhost:5493 in the main checkout; a worktree's slot shifts
the port), which `bun run test:e2e` sets from the mcproc manifest through `mcproc exec`; it
serves the web app's production build (`apps/web/dist`, written by the launcher before each
run; no dev server) and, under `/backend/`, the gateway on one origin.

Specs are tagged `@smoke` (`user/`: sign up, rename, a browser that blocks site data, a
database that will not open; `contract/`: the UI manifest) or
`@full` (`sync/`: the slower specs of one account on several devices; `organisation/`: two
accounts, each in a browser of its own):

- `contract/01-manifest`: the manifest the front serves at `/ui-manifest/manifest.json`
  (`no-store`) is valid against the schema served beside it and names contract version 1; on
  `/sign-in`, every anchor `window.__perch.ui.anchors()` reports is in the manifest's `ids` with
  the same kind, or derived from one with a suffix it lists, and the helper reports the page's
  URL with `app-shell.status` in `ready`.
- `user/03-blocked-storage`: a browser that refuses the page its localStorage is told that it
  keeps no data for Perch, and gets no sign-in form.
- `user/04-unopenable-database`: once the account's local database is broken, the page says it
  could not open the data (`app-shell.status` in `failed`) and offers
  `app-shell.sign-out-here-button`, which lands on sign-in with no database and no saved
  account left.
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
- `sync/06-my-devices`: My devices lists the account's devices, this one marked and the other
  seen within the last minute; a device signed out from another one is on the sign-in page
  with the notice `signed-out-elsewhere` within 5 seconds and its database is gone;
  signing out everywhere sends both devices to the sign-in page, and the account signs in
  again after it.
- `sync/07-blocked-delete`: a sign-out ends within 15 seconds although a second tab holds the
  account's database open, and the sign-in page says the data goes once the other tabs are
  closed (`delete-pending`); the database is gone within 10 seconds of closing that tab.
- `sync/08-one-account-per-browser`: a tab left on the sign-in page follows the account another
  tab signs in, onto "/me" within 5 seconds, and the browser keeps one account database.
- `sync/09-key-renewal`: a route that refuses the access token (the test replaces it in the
  browser's storage, as an expired one would be refused) has the tab that leads the sync renew
  the keys with one `renew` over its open socket, from that tab and from a second tab; the route
  answers with the new keys within 5 seconds, and no tab opens another sync socket.
- `organisation/01-shared-notes`: user A creates an organisation and invites user B; B sees
  it and A's note without a reload, B's note reaches A within 5 seconds, and B sees neither
  the members nor A's profile.
- `organisation/02-outsider`: an account that was not invited sees no organisation and no
  notes, and its own organisation shows none of the other's.
- `organisation/03-membership-change`: an invitation reaches B's open page within 5 seconds;
  a removal takes the organisation away within 5 seconds, and its IndexedDB database is gone
  from B's browser within 5 seconds; after a reload B still shows no organisation.
- `organisation/04-edit-own-admin-any`: a member edits and deletes only its own notes while an
  administrator edits and deletes any; B's edit reaches A, A's edit of B's note reaches B, and
  each deletion reaches the other device, all within 5 seconds and without a reload.

Five specs write measurements into the test's annotations, shown in the HTML report:
`sync-latency-ms` (from the click on device B to the new name on device A),
`idle-frames-per-minute`, `note-sync-latency-ms` (from the click on "Add note" on device B to
the note on device A), `note-edit-sync-latency-ms` (from the click on "Save" on device B to the
edited note on device A) and `membership-change-ms` (from the click on "Invite" on device A to
the organisation and its note on device B).

## Key exports

None; tests only. `src/<feature>/*.e2e.spec.ts` are the tests; their scenarios are the
`scenarios` of `contract/screens.json`. `src/support/fixtures.ts`: the `test` with the step
check and its fixtures,
`signedIn` (device A, signed up on `/me`), `secondDevice` (device B, a browser context of
its own that opens and signs in with the same account when a test asks) and `anotherAccount`
(another user: a fresh account and a browser context of its own that opens and signs up when
a test asks), `appReady` (waits for `app-shell.status` in `ready`, `APP_READY`), `signIn`
(fails at once when the sign-in page shows its error, naming its code), `signUp`,
`pageLoads` (counts a page's full loads, for "without a reload"), and `notice` and
`signInNotice`, which locate `app-shell.notice-message` and `user.sign-in.notice-message` by
their anchor and code together. Tests locate elements by their anchors and assert codes,
states and values, never the page's wording.
`src/support/network.ts`: `SyncNetwork`, which routes a page's sync socket through the test so
it can go offline and back (Playwright's offline mode leaves an open WebSocket up).
`src/support/storage.ts`: the IndexedDB databases a page's browser keeps and the names the app
gives them (`databases`, `identityDatabase`, `organisationDatabase`).
`src/support/organisation.ts`: the organisation flows the tests share, from an open "/org"
page: `createOrganisation` (its creator's role badge then carries `admin`), `inviteMember`
and `expectInvited` (the notice `invited` and the account in the members list).
`src/support/data.ts`: the generators (accounts, names, bios, organisation keys and names,
note texts).

## Commands

- `bun run test:e2e` (repository root): runs the launcher through `mcproc exec`, under a 4G
  memory lease (the run waits its turn when the host is short of memory) and with
  `E2E_BASE_URL` set; the launcher builds the dependencies and the web app's production
  build through turbo with `PERCH_UI_HOOKS=1`, so the build installs the page helper (and stops when `apps/web/dist/index.html` is missing afterwards), starts
  the `e2e` profile with `--reload` (apps already online restart: the database is empty, the
  gateway and the front run the current code and configuration) and waits for it, then runs
  Playwright; extra arguments go to Playwright (`--grep @smoke`, `sync/`,
  `--update-snapshots=missing`). `CI=1` runs one worker.
- `bun run e2e:scaffold <scenario id>` (repository root): writes the test of a new scenario of
  `contract/screens.json` from its steps, never over an existing file; `bun run e2e:coverage`
  checks that every scenario has its test.
- `mcproc stop e2e`: stops the `e2e` profile.
- `bun run typecheck`, `bun run lint`.
