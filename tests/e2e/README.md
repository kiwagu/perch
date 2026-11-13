# E2E tests (`@workspace/e2e`)

## Role in the architecture

End-to-end tests of the web application in a real browser, on two Playwright projects:
`mobile` (Pixel 7) runs every test, `desktop` (1280x800) the `@smoke` ones. Each test pairs
with an instruction-style scenario, a Markdown file in `scenarios/` beside `src/`: the scenario
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
and the search parameter of its link, and the language of its HTML's root element, never its
wording; a notice, a mail that only tells (`notices` on the action), is held to its recipient,
its language and its plain link to the declared screen or none, and to what it must not name; a
failed check prints no address, link, token or HTML of the mail. Key pages are compared with screenshots on
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
checkout), which `mcproc exec` sets too. A test of the operator console appoints its operator as
the host does, with the operator command against the stand's database at `SURREAL_URL`, which
`mcproc exec` sets as well (`src/support/operators.ts`).

Each test carries the tag of its scenario's `tags`, written by hand in its `test.describe`
(`{ tag: '@smoke' }`); nothing compares the two yet. The tag decides where a test runs: the
`mobile` project runs all of them, the `desktop` project only `@smoke` (its `grep`), so a phone
goes through every scenario and a desktop through the `@smoke` ones. `@smoke`:
`user/base/` (one account on its own) and `organisation/base/` but the tests named below,
`not-found/base/`, `console/flows/not-operator` (an account and a guest at the console's
addresses), `contract/base/manifest`, and `guest-start`, `guest-without-navigation`,
`open-before-data`, `start-failed` and `toast-before-data` of `app-shell/base/`. `@full`: `user/flows/` (one account across devices,
tabs or time), `device/base/my-devices`, the `user/base/` tests of a limit, of a link opened
again or replaced, or of several mails of one run (`resend-same-answer`, `resend-limit`,
`forgot-password-limit`, `reset-link-replaced`, `reset-link-used`, `reset-password-rules`,
`reset-link-after-email-change`, `reset-verifies-email`, `confirm-link-used`,
`change-email-refused`, `delete-account-refused`, `delete-link-used`), the `organisation/base/`
tests of an invitation (`invite-new-account`, `accept-by-link`, `decline-invitation`,
`revoke-invitation`, `copy-invitation-link`: two accounts and their mails) and
`theme-from-the-frame`, the other `app-shell/base/` tests (install,
a new version, offline, an outdated protocol, the sync status, a sign-out in another tab while
the data opens or once it did not open), `app-shell/flows/` (a guest
across the tabs of one browser), `organisation/flows/` (two accounts, each in a browser of
its own), `console/base/` (an operator and the accounts it acts on, each in a browser of its
own) and the other `console/flows/` tests (an account banned or given a new email before it
verified its email, an operator whose role is taken away while its console is open). `bun run
test:e2e --grep @smoke` runs the first set
on both projects.

Every browser of the suite reaches the front from 127.0.0.1, and the gateway counts its
per-address limits by the client address the front names, so each worker's browsers claim an
address of their own (`src/support/client-address.ts`), which the `caddy-e2e` front names to the
gateway (`infra/dev/`). A worker's tests share its address's limits, which a launcher run starts
afresh by restarting the gateway, as one client running them one after another would; no two
workers share an address, so the limits do not bind their number. Per worker, with two, a run
spent when it was measured: at most 12 credential checks (sign-ups, sign-ins, verifications,
changes of a password or an email and requests to delete an account) in any ten seconds, of 20;
at most 103 of 200 mails per quarter hour (sign-ups, resends, reset requests, email changes,
deletion requests and invitations: about 200 in the whole run); at most 8 of 20 attempts at a
reset link per ten minutes, 5 of 20 at a confirmation link, 4 of 20 at a deletion link and 8 of
20 reads of an invitation's link; 15 of 30 organisations created an hour; at most 13 of 60
invitations per ten minutes, and 2 of an administrator's 30. An invitation's own work, from the
request's start to its wait for the floor, took 3 to 10 ms in the run (19 invitations), well
under the 300 ms floor that makes every invitation answer in the same time. The limits a test runs into on
purpose (`resend-limit`, `forgot-password-limit`) are an email's, and every test uses fresh
emails. A test uses as few emails, sign-ins and links as its scenario needs; a new one that signs
up, mails, opens a link or creates an organisation counts against these.

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
- `user/flows/theme-across-tabs` and `language-across-tabs`: a theme or a language chosen on
  `/settings` in one tab shows in the account's other tab of the browser within 5 seconds of the
  choice, without a reload; the theme is the account's on the next device it signs in on, and
  one chosen there reaches both tabs.
- `app-shell/flows/theme-across-guest-tabs`: a theme a guest chooses in the frame of one tab
  shows in the browser's other guest tab within 5 seconds of the choice, without a reload.
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
- `organisation/flows/shared-notes`: user A creates an organisation and invites user B; B
  accepts the invitation on its organisation page and sees the organisation and A's note
  without a reload, B's note reaches A within 5 seconds, and B sees neither the members nor
  A's profile.
- `organisation/flows/outsider`: an account that was not invited sees no organisation and no
  notes, and its own organisation shows none of the other's.
- `organisation/flows/membership-change`: user B accepts the invitation on a third browser,
  signed in and through the link of the invitation mail, and the organisation reaches B's open
  page within 5 seconds; a removal takes the organisation away within 5 seconds, and its
  IndexedDB database is gone from B's browser within 5 seconds; after a reload B still shows no
  organisation.
- `organisation/flows/edit-own-admin-any`: a member (who accepted its invitation on its
  organisation page) edits and deletes only its own notes while an administrator edits and
  deletes any; B's edit reaches A, A's edit of B's note reaches B, and each deletion reaches the
  other device, all within 5 seconds and without a reload.
- `organisation/flows/invitation-elsewhere`: the link of an invitation to an email with no
  account, opened by another account, shows the organisation and the role with `other-account`
  and no buttons; opened by a guest, it asks to sign in to the invited account and links to
  `/sign-in`.
- `organisation/flows/invitation-replaced`: a second invitation of the same email, as an
  administrator, replaces the first: one item in the invitations sent, the first link
  `link-invalid`, the second makes B an administrator.
- `organisation/flows/role-change`: A makes B an administrator; within 5 seconds and without a
  reload B shows the administrator's page and may delete A's note, which leaves A's page; B makes
  A a member, A's page drops the administrator's regions within 5 seconds; B, the last
  administrator, cannot make itself a member (`last-admin`, its select still `admin`).
- `user/flows/delete-account-after-handover`: the only administrator makes B an administrator and
  itself a member, then deletes its account; B keeps the organisation, alone among its members,
  with A's note.

Six specs write measurements into the test's annotations, shown in the HTML report:
`sync-latency-ms` (from the click on device B to the new name on device A),
`idle-frames-per-minute`, `note-sync-latency-ms` (from the click on "Add note" on device B to
the note on device A), `note-edit-sync-latency-ms` (from the click on "Save" on device B to the
edited note on device A), `membership-change-ms` (from the click on "Accept" on device C to
the organisation and its note on device B) and `role-change-ms` (from the choice of the
administrator role in B's role select on device A to the administrator's page on device B).

## Key exports

None; tests only. `src/<entity>/<layer>/[<area>/]<slug>.e2e.spec.ts` are the tests, and
`scenarios/` beside them holds their scenarios, one file each at the same path.
`scripts/spec-reporter.ts`: the run's log, as the workers run the tests side by side: each spec
file's tests printed together once the last of them ended, one line each (outcome, project,
title, tags, time) with, under a failed run, its errors with their stack and cause and where its
trace is, and under any run the output it wrote, each attempt of a retried test under a header
of its own; then the tally, with the failed and the flaky tests again. A run stopped early
prints every file it had not printed yet, a test that never started marked `not run`. The HTML
report (`playwright-report/`) has the rest; `--list` prints Playwright's own listing.
`src/support/fixtures.ts`: the `test` with the step
check and its fixtures, every browser of a test claiming its worker's client address at the front
(`extraHTTPHeaders`, `client-address.ts`),
`signedIn` (device A, signed up through its mail on `/me`), `secondDevice` (device B, a browser context of
its own that opens and signs in with the same account when a test asks), `anotherAccount`
(another user: a fresh account and a browser context of its own that opens and signs up when
a test asks) and `freshDevice` (device B of an account the test makes itself: a browser
context of its own that opens nothing and signs nothing in by itself), `freshDevices` (as many
devices of such an account as the test opens, each a browser context of its own), `appReady`
(waits for `app-shell.status` in `ready`, `APP_READY`), `syncSays` (waits until
`app-shell.sync-message` carries a code, `synced` by default), `signIn`
(fails at once when the sign-in page shows its error, naming its code), `signOut` (clicks the
profile's sign-out button and waits for `/sign-in`), `startSignUp` (submits
the sign-up form and waits until the page asks to check the mail, reading the page every 50 ms:
the gateway answers a sign-up no sooner than 800 ms, by when an assertion would look only every
500 ms), `signUp` (counts the email's mails, `startSignUp`, then
opens the link of the declared `sign-up` mail, the first after those counted, in the same page,
which signs the account in, on `/me`: an email invited before it signs up holds the invitation
first), `expectPathname` (waits for a page's path, reading the path alone, so a page opened
from a mail's link never prints its token), `pageLoads` (counts a page's full loads, for
"without a reload"), and `notice`,
`signInNotice` and `checkYourMail`, which locate `app-shell.notice-message`,
`user.sign-in.notice-message` and `user.sign-in.mail-message` by their anchor and code
together. Tests locate elements by their anchors and assert codes,
states and values, never the page's wording.
`src/support/engines.ts`: `holdEngines`, which holds back the WASM files of a browser context's
pages until the test lets them go, so a page cannot open an account's data meanwhile, and
`holdTabEngines`, which holds those of one page alone, the ones its database worker fetches
included, until the test lets them load or refuses them as a dropped network would, so another
tab of the same browser still opens an account's data (a context's hold would stall that tab's
sign-in too).
`src/support/network.ts`: `SyncNetwork`, which routes a page's sync socket through the test so
it can go offline and back (Playwright's offline mode leaves an open WebSocket up), and can wait
offline until the app's reconnect delay has grown to its longest (`untilLongestReconnectDelay`);
`BACK_ONLINE_MS`, how long a page back online may take to connect again.
`src/support/storage.ts`: the IndexedDB databases a page's browser keeps and the names the app
gives them (`databases`, `identityDatabase`, `organisationDatabase`).
`src/support/shown.ts`: `watchShown`, which watches a page from now on for an element a selector
matches and tells, once asked, whether one appeared, though it is gone by then: "without …
having been shown", which a look after the move cannot tell.
`src/support/browsers.ts`: what every browser a test opens is held to, from before its first
page: `watchBrowser` (the front's security policy and the settled states), `expectWatched`
(fails the test with what it reported) and `ownBrowser` (a browser context of the test's own,
opened on first use and checked as it closes); the fixtures watch the test's own `page` the
same way, and the step check reads `browsers`.
`src/support/client-address.ts`: the client address the browsers of a worker claim at the e2e
front (`CLIENT_ADDRESS_HEADER`, `clientAddressOf`), one per worker slot, from 198.18.0.0/15, a
range set aside for benchmarks: the front names it to the gateway as the request's address, so
each worker spends per-address limits of its own.
`src/support/security.ts`: `SECURITY_HEADERS`, the headers the front sends with every
response as the stands' Caddyfile writes them, and `watchSecurity`, which watches one browser
context for a test (its documents' and scripts' headers, the CSP violations its pages and
their workers report).
`src/support/settled.ts`: `watchSettled`, which exposes `window.__perchSettledState` in every
page of a browser context: the app's e2e build reports to it each state a screen's machine, or
the frame's, settles in, with the page as `window.__perch.ui.anchors()` reads it then, and each
report is held to the manifest the stand serves (`settledProblems` of `@workspace/ui-contract`).
Of the anchors a screen renders only where its flow lists them, one the state does not render
is not visible, and one it renders is on the page and visible; a test fails at its end with
every problem a state it passed through showed, though no line of the test asks for it.
`src/support/organisation.ts`: the organisation flows the tests share, from an open "/org"
page: `createOrganisation` (its creator's role badge then carries `admin`), `inviteEmail` (an
email with an account or without one, a role when given: the toast `invited` and the email in
the invitations sent), `acceptOnOrg` (opens "/org" by the navigation, accepts the invitation of
the organisation of that name among those received, and waits for the toast
`invitation-accepted` and the heading), `expectMembers` (the members list holds exactly these
emails: an item shows its email beside its role select), `expectInvitationMail` and
`openInvitationMail` (the mail of `organisations.invite` after the mails of the address counted
before the invitation, held to its declaration, the second one also opening its link), and the
locators `memberItems`, `sentItems`, `receivedItem` and `noteItem`.
`src/support/password-reset.ts`: the reset of a password the tests share: `askForReset` (opens
`/forgot-password`, asks for the mail and waits for its message), `sendResetRequest` (clicks
its send button and waits for the gateway's answer), `resetRequested` (its message),
`openResetMail` (opens the link of the reset mail, held to its declaration) and
`enterNewPassword` (types the new password twice on `/reset-password` and submits it).
`src/support/email-change.ts`: the change of an email from `/settings`: `askToChangeEmail`
(sends the confirmation and waits for its message), `emailChangeRequested` (that message) and
`openChangeEmailMail` (opens the link of the mail to the new email, held to its declaration).
`src/support/account-deletion.ts`: the deletion of an account: `openSettings` (opens `/settings`
and waits for its deletion form), `sendDeletionRequest` (types the password into the deletion
form, sends it and waits for the gateway's answer), `askToDeleteAccount` (sends it and waits for
`deletionRequested`, the form's message), `openDeletionMail` (opens the link of the deletion
mail, held to its declaration), `deleteAccount` (presses the button of `/delete-account` and
confirms the frame's question, checked for its code `delete-account`) and `accountDeleted` (the
page's message once the account is gone).
`src/support/device-limit.ts`: an account at its limit of ten devices and a sign-in past it:
`signInDevicesCToK` (signs the account in on nine more devices in turn, each synced on `/me`,
the first, device C, with its sync socket routed through the test), `submitSignIn` (submits the
sign-in form without waiting for its answer), `deviceLimitDialog` (the dialog asking whether to
sign in past the limit, by its anchor and its code) and `expectDeviceCSignedOut` (the list of
devices once the sign-in past the limit went through: device C's alone `revoked`, by the order
the devices signed in).
`src/support/data.ts`: the generators (accounts, emails, a group of emails sharing a prefix,
another, a new and a wrong password, names, bios, the reason of a ban, organisation keys and
names, note texts).
`src/support/mailbox.ts`: `mailbox`, the e2e stand's mailbox (`Mailbox` of `@workspace/mailbox`
at `MAILBOX_URL`): the mails to an address, their count, and the next one, waited for; and
`expectBoundedNonArrival`, a bounded non-arrival: an address's mail count stays put from the
moment a test saw the answer to an action that must send none until `MAIL_DELIVERY_WINDOW_MS`
(2 s) after it, read every 200 ms (no mail within the window, not "never").
`src/support/mail-contract.ts`: every mail a test reads is held to its declaration in
`platform.yaml`: `expectDeclaredMail` (its one recipient, the path of the screen its link opens
with the declared search parameter set, and the `lang` of its HTML's root element as parse5
reads it, from the action's parameters, the account, or, for an invitation to an email that has
an account, that account's language (`recipient`; an email with none is mailed in the inviter's
language); each check asserts a comparison's outcome
under a fixed message), `openMailLink` (opens a mail's link; its failure names no link) and
`openDeclaredMail` (waits for the action's mail to its declared recipient after the ones a test
has seen, holds it to its declaration and opens its link).
`src/support/notice-contract.ts`: every notice a test reads is held to its declaration under
`notices` in `platform.yaml`, named `<action>.<name>` as a scenario names it:
`expectDeclaredNotice` (its one recipient, the account's address before the action or a
parameter's; the `lang` of its HTML's root element; every link it carries, in its HTML and its
text, opening the declared screen at one of its routes' paths with no search and no fragment,
or no link when it declares none; and, given `hides`, that its subject, text and HTML, its own
recipient's address taken out, name neither that email nor its local part nor its domain) and
`nextDeclaredNotice` (waits for the notice to its declared recipient after the mails a test has
seen there and holds it to its declaration). A failure prints no address, link or HTML.
`src/support/operators.ts`: `grantOperator` and `revokeOperator`, which set the platform role
of the account of an email as the host does, with the operator command
(`apps/gateway/scripts/operator/cli.ts`) run under Bun from the repository root against the
stand's database (`SURREAL_URL`) as its root user: Playwright's workers run in Node, which cannot
load the `.surql` files the command's code imports. A command that does not exit 0 fails the
test with its exit code and its own words, never its arguments or the password. A device learns
a role at its next hello, so a test reloads the operator's page after the grant.
`src/support/console.ts`: the operator console the tests share: `signUpOperator` (signs up
through the mail, grants the role, reloads, and waits for the navigation's console link),
`openUsers` (opens `/console/users` through that link and waits for its search box: the console's
pages load on their own after the frame), `searchAccounts`, `chooseSize`, `openAccount` (searches
an email and follows the open link of its entry once the address carries the search, then waits
for the card, read; answers the account's id), `expectAddress` (the path and exactly the search
parameters expected), `expectRange` (the list's range by its `data-from`, `data-to` and
`data-total`), and the locators `consoleLink`, `accountItems`, `accountItem` and
`listedEmails`.

## Commands

- `bun run test:e2e` (repository root): runs the launcher through `mcproc exec`, under a 4G
  memory lease (the run waits its turn when the host is short of memory), in mcproc's `e2e`
  group (`--exclusive e2e`: one e2e run or `perf:measure` at a time on the host, whichever
  checkout starts it; a waiting run says whom it waits for, for up to an hour) and with
  `E2E_BASE_URL`, `MAILBOX_URL` and `SURREAL_URL` set; the launcher builds the dependencies and the web app's production
  build through turbo with `PERCH_UI_HOOKS=1`, so the build installs the page helper (and stops when `apps/web/dist/index.html` is missing afterwards), starts
  the `e2e` profile with `--reload` (apps already online restart: the database is empty, the
  gateway and the front run the current code and configuration) and waits for it, then runs
  Playwright in a network namespace of its own (below); extra arguments go to Playwright (`--grep @smoke`, `user/flows/`,
  `--update-snapshots=missing`). It runs two workers, `CI=1` or not (`workers` in
  `playwright.config.ts`, measured on the dev host), and its log is
  `scripts/spec-reporter.ts`'s; `--reporter=list` gives Playwright's own.
- The browser's own network (`scripts/isolated-network.ts`): Chromium on Linux aborts every
  request in flight (`net::ERR_NETWORK_CHANGED`) when a network interface it can see comes, goes
  or changes its address, and every container started or stopped on the host adds or removes one,
  a stand of another checkout or another project's alike. So the launcher runs Playwright under
  pasta (package `passt`, rootless): pasta copies the host's IPv4 setup into a network namespace
  once, so the browser sees a network that stays the same, and forwards the loopback ports of
  `E2E_BASE_URL`, `MAILBOX_URL` and `SURREAL_URL` (the stand's database, which the operator
  command a test runs writes to) to the host, and no other port either way (its gateway
  address does not lead to the host's loopback either). IPv4 only: inside,
  `localhost` resolves to ::1 first, where the front does not listen. IPv6 is also switched off
  inside before Playwright starts: the kernel gives the namespace's interface an IPv6 link-local
  address whose duplicate address check ends a second or two later, an address change that
  aborted the requests of the run's first test. Without pasta the launcher
  stops before the build and names the package; it never runs the browser on the host's network.
  `perf:measure` stays on the host's network, as pasta's forwarding would weigh on its timings.
- `bun run perf:measure [--runs=5] [--slow-4g]` (repository root): the start's timings against
  their budgets (`scripts/perf-measure.ts`, through `mcproc exec` under a 3G lease and in the
  `e2e` group, so no e2e run shares the CPU with its timings). It builds
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
- `bun run test` (here): the unit tests of the reporter, of the browser's network and of the
  support's operator command (`bun test ./scripts ./src/support`).
- `bun run typecheck`, `bun run lint`.
