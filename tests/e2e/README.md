# E2E tests (`@workspace/e2e`)

## Role in the architecture

End-to-end tests of the web application in a real browser, on two Playwright projects:
`mobile` (Pixel 7) first, then `desktop` (1280x800). Each test pairs with an
instruction-style scenario, a Markdown file in `scenarios/` beside `src/`: the scenario
`scenarios/<entity>/<layer>/[<area>/]<slug>.md` with the test
`src/<entity>/<layer>/[<area>/]<slug>.e2e.spec.ts`, whose first line names the scenario's
id, its path without `.md` (`// scenario: user/base/sign-up`). A scenario opens with a YAML
front matter (`tags`, `devices` with the role each device acts as, `data`) and then has its
title, `Where:`, `## Scenario:`, `### Steps` and `### Expected result`, the text naming the
contract in brackets; `contract/README.md` has the full shape. The scenarios are the
contract's feedback loop: one that cannot be written from the contract alone names a gap of
the contract, fixed there and never worked around in a test. `bun run e2e:coverage` checks
the pairs, and `bun run contract:check:consumers` checks every anchor, code, state and value
a test names as a literal against the contract. After every step a check fails the test when
any open page scrolls sideways. At the end of every test a check fails it when a document or a
script of the front came without the front's security headers, or when a page or one of its
workers reported a Content-Security-Policy violation on the console. Every test blocks the app's
service worker (`serviceWorkers: 'block'`, so requests and page loads stay the network's) but
`app-shell/base/open-offline`, which lets it run to open the app offline. Each test signs up fresh accounts in fresh browser contexts,
with data generated from the seed catalog, each through the link of its verification mail, read
from the stand's mailbox. Every mail a test reads is held to its declaration in the contract
(`contract/domain/platform.yaml`, `mail` on the action that sends it): its recipient, the path
and the search parameter of its link, and the language of its HTML, never its wording. Key pages are compared with screenshots on
`mobile`; the baselines are not committed: the first run on a machine writes them, later
runs compare against them; after an intended change of a page, `bun run test:e2e
--update-snapshots=changed` rewrites the ones that differ.
The stand is the mcproc `e2e` profile (`surrealdb-e2e`, `maildev-e2e`, `gateway-e2e` and the
`caddy-e2e` front), not Playwright's web server, so `mcproc logs e2e` shows what a run saw. Tests
open the front at `E2E_BASE_URL` (https://localhost:5493 in the main checkout; a worktree's slot
shifts the port), which `bun run test:e2e` sets from the mcproc manifest through `mcproc exec`; it
serves the web app's production build (`apps/web/dist`, written by the launcher before each
run; no dev server) and, under `/backend/`, the gateway on one origin. They read the mails the
gateway sent from the stand's MailDev at `MAILBOX_URL` (http://127.0.0.1:1090 in the main
checkout), which `mcproc exec` sets too.

Each test carries the tag of its scenario's `tags`, written by hand in its `test.describe`
(`{ tag: '@smoke' }`); nothing compares the two yet. `@smoke`: `user/base/` (one account on
its own) and `contract/base/manifest`. `@full`: `user/flows/` (one account across devices,
tabs or time), `device/base/my-devices`, `user/base/resend-same-answer` and
`user/base/resend-limit` (several mails of one run), and `organisation/flows/` (two accounts,
each in a browser of its own). `bun run test:e2e --grep @smoke` runs the first set.

- `contract/base/manifest`: the manifest the front serves at `/ui-manifest/manifest.json`
  (`no-store`) is valid against the schema served beside it and names contract version 1; on
  `/sign-in`, every anchor `window.__perch.ui.anchors()` reports is in the manifest's `ids` with
  the same kind, or derived from one with a suffix it lists, and the helper reports the page's
  URL with `app-shell.status` in `ready`.
- `app-shell/base/open-before-data`: a signed-in device reloaded while its database engines
  are held back shows `app-shell.status` in `opening-data` on `/me`, with the account's four
  navigation links and `user.profile.status` in `loading`; once the engines load, it reaches
  `ready` with the account's name.
- `app-shell/base/guest-start`: a guest whose database engines cannot load still reaches
  `ready` on `/sign-in` with the sign-in form.
- `user/base/sign-up`: a new user signs up and is asked to check the mail, still on
  `/sign-in`; the link of the sign-up's mail lands on `/me` with the notice `welcome`, the
  entered name and email, and stays signed in after a reload.
- `user/base/taken-email`: a sign-up with an email that has an account answers as a new one
  does and sends no mail; the account signs in with its own password, not the other one.
- `user/base/sign-in-unverified`: an account whose email is not verified is refused with
  `email-not-verified`; the resend sends the mail again, and its link signs in.
- `user/base/verify-link-invalid`: a made-up link answers `link-invalid` with a form that sends
  a new one, whose link signs in.
- `user/base/verified-before`: a link opened again answers `verified-before`, signs nothing in
  and leads to the sign-in page.
- `user/base/verified-sign-in`: an account whose email is verified signs in onto `/me`.
- `user/base/resend-same-answer`: a resend answers alike for an email waiting for its link, an
  unknown one and a verified one, and only the first gets a mail.
- `user/base/resend-limit`: one email takes three resends within a quarter of an hour; the
  fourth answers `rate-limited` and sends nothing.
- `user/base/edit-profile-name`: a signed-in user changes the name, sees the toast
  `profile-saved`, and keeps the new name after a reload.
- `user/base/blocked-storage`: a browser that refuses the page its localStorage is told that
  it keeps no data for Perch, and gets no sign-in form.
- `user/base/unopenable-database`: once the account's local database is broken, the page says
  it could not open the data (`app-shell.status` in `failed`) and offers
  `app-shell.sign-out-here-button`, which lands on sign-in with no database and no saved
  account left.
- `user/flows/two-devices`: a bio written on device A reaches device B, which signs in after
  it; a name changed on B reaches A within 5 seconds.
- `user/flows/offline-edit`: B edits offline while A edits online; both changes meet once B
  is back.
- `user/flows/one-leader-per-browser`: two tabs of one browser share one sync leader; the
  other tab's edit reaches B, and it takes over within 2 seconds when the leader closes.
- `user/flows/sign-out`: signing out deletes the device's database and leaves B signed in;
  signing in again restores the profile from the server; an offline sign-out with an
  unsent change asks first, and the sign-out takes the notice with the account.
- `user/flows/idle-traffic`: an idle visible tab, its clock driven by the test through 10
  minutes, sends at most 2 sync frames a minute.
- `user/flows/blocked-delete`: a sign-out ends within 15 seconds although a second tab holds
  the account's database open, and the sign-in page says the data goes once the other tabs are
  closed (`delete-pending`); the database is gone within 10 seconds of closing that tab.
- `user/flows/one-account-per-browser`: a tab left on the sign-in page follows the account
  another tab signs in, onto "/me" within 5 seconds, and the browser keeps one account
  database.
- `device/base/my-devices`: My devices lists the account's devices, this one marked and the
  other seen within the last minute; a device signed out from another one is on the sign-in
  page with the notice `signed-out-elsewhere` within 5 seconds and its database is gone;
  signing out everywhere sends both devices to the sign-in page, and the account signs in
  again after it.
- `organisation/flows/shared-notes`: user A creates an organisation and invites user B; B sees
  it and A's note without a reload, B's note reaches A within 5 seconds, and B sees neither
  the members nor A's profile.
- `organisation/flows/outsider`: an account that was not invited sees no organisation and no
  notes, and its own organisation shows none of the other's.
- `organisation/flows/membership-change`: an invitation reaches B's open page within 5
  seconds; a removal takes the organisation away within 5 seconds, and its IndexedDB database
  is gone from B's browser within 5 seconds; after a reload B still shows no organisation.
- `organisation/flows/edit-own-admin-any`: a member edits and deletes only its own notes while
  an administrator edits and deletes any; B's edit reaches A, A's edit of B's note reaches B,
  and each deletion reaches the other device, all within 5 seconds and without a reload.

Five specs write measurements into the test's annotations, shown in the HTML report:
`sync-latency-ms` (from the click on device B to the new name on device A),
`idle-frames-per-minute`, `note-sync-latency-ms` (from the click on "Add note" on device B to
the note on device A), `note-edit-sync-latency-ms` (from the click on "Save" on device B to the
edited note on device A) and `membership-change-ms` (from the click on "Invite" on device A to
the organisation and its note on device B).

## Key exports

None; tests only. `src/<entity>/<layer>/[<area>/]<slug>.e2e.spec.ts` are the tests, and
`scenarios/` beside them holds their scenarios, one file each at the same path.
`src/support/fixtures.ts`: the `test` with the step
check and its fixtures,
`signedIn` (device A, signed up through its mail on `/me`), `secondDevice` (device B, a browser context of
its own that opens and signs in with the same account when a test asks) and `anotherAccount`
(another user: a fresh account and a browser context of its own that opens and signs up when
a test asks), `appReady` (waits for `app-shell.status` in `ready`, `APP_READY`), `signIn`
(fails at once when the sign-in page shows its error, naming its code), `startSignUp` (submits
the sign-up form and waits until the page asks to check the mail), `signUp` (`startSignUp`, then
opens the link of the declared `sign-up` mail in the same page, which signs the account in, on
`/me`), `pageLoads` (counts a page's full loads, for "without a reload"), and `notice`,
`signInNotice` and `checkYourMail`, which locate `app-shell.notice-message`,
`user.sign-in.notice-message` and `user.sign-in.mail-message` by their anchor and code
together. Tests locate elements by their anchors and assert codes,
states and values, never the page's wording.
`src/support/engines.ts`: `holdEngines`, which holds back the WASM files of a browser context's
pages until the test lets them go, so a page cannot open an account's data meanwhile.
`src/support/network.ts`: `SyncNetwork`, which routes a page's sync socket through the test so
it can go offline and back (Playwright's offline mode leaves an open WebSocket up).
`src/support/storage.ts`: the IndexedDB databases a page's browser keeps and the names the app
gives them (`databases`, `identityDatabase`, `organisationDatabase`).
`src/support/security.ts`: `SECURITY_HEADERS`, the headers the front sends with every
response as the stands' Caddyfile writes them, and `watchSecurity`, which watches one browser
context for a test (its documents' and scripts' headers, the CSP violations its pages and
their workers report); the fixtures watch every browser a test opens.
`src/support/organisation.ts`: the organisation flows the tests share, from an open "/org"
page: `createOrganisation` (its creator's role badge then carries `admin`), `inviteMember`
and `expectInvited` (the toast `invited` and the account in the members list).
`src/support/data.ts`: the generators (accounts, another password, names, bios, organisation
keys and names, note texts).
`src/support/mailbox.ts`: `mailbox`, the e2e stand's mailbox (`Mailbox` of `@workspace/mailbox`
at `MAILBOX_URL`): the mails to an address, their count, and the next one, waited for.
`src/support/mail-contract.ts`: every mail a test reads is held to its declaration in
`platform.yaml`: `expectDeclaredMail` (its one recipient, the path of the screen its link opens
with the declared search parameter set, and the language of its HTML, from the action's
parameters or the account) and `openDeclaredMail` (waits for the action's mail to its declared
recipient after the ones a test has seen, holds it to its declaration and opens its link).

## Commands

- `bun run test:e2e` (repository root): runs the launcher through `mcproc exec`, under a 4G
  memory lease (the run waits its turn when the host is short of memory) and with
  `E2E_BASE_URL` and `MAILBOX_URL` set; the launcher builds the dependencies and the web app's production
  build through turbo with `PERCH_UI_HOOKS=1`, so the build installs the page helper (and stops when `apps/web/dist/index.html` is missing afterwards), starts
  the `e2e` profile with `--reload` (apps already online restart: the database is empty, the
  gateway and the front run the current code and configuration) and waits for it, then runs
  Playwright; extra arguments go to Playwright (`--grep @smoke`, `user/flows/`,
  `--update-snapshots=missing`). `CI=1` runs one worker.
- `bun run perf:measure [--runs=5] [--slow-4g]` (repository root): the start's timings against
  their budgets (`scripts/perf-measure.ts`, through `mcproc exec` under a 3G lease). It builds
  and brings the stand up as the launcher does (`scripts/stand.ts`), then times in Chromium, as
  a Pixel 7 with the CPU slowed four times and the service worker blocked, a guest's first
  visit (first paint 500 ms, ready 1 s) and a signed-in reload with the cache kept and cleared
  (the profile's screen, ready, and the profile with its data 1.5 s); each step is timed in the page when its element first
  appears, and each number is the median of the runs. It measures and never fails: the numbers
  move with the host's load. `--slow-4g` adds a slow mobile network, outside the budgets.
- `bun run e2e:scaffold <scenario id>` (repository root): writes the failing test of a new
  scenario file of `scenarios/` from its steps, never over an existing file;
  `bun run e2e:coverage` checks that every scenario has its test and every test its scenario.
- `mcproc stop e2e`: stops the `e2e` profile.
- `bun run typecheck`, `bun run lint`.
