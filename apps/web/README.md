# Web application (`@workspace/web`)

## Role in the architecture

The browser application. It works with the signed-in identity's local replica: a
SurrealDB engine in a Web Worker on that identity's own IndexedDB database, and the
identity's private region as a CRDT document projected into it, kept in step with the
server through the gateway. Features are Angular-like modules under
`src/features/<feature>` with `domain`, `application` and `presentation` layers; reads and
writes are declared in `.surql` files next to their components and compiled by the
modeling stage.

- `src/composition/`: the composition root, the only code that imports adapters. Nothing
  is opened while nobody is signed in, and the page renders without waiting for any database:
  the space's code, Loro's WASM engine with it, loads when a space first opens (`spaceCode`), so
  a guest's sign-in page loads no engine, and once that page is up the engines a sign-in opens
  load ahead of it (`warmEngines`: the space's code, and the database engine's WASM module into
  the browser's cache, at low priority; nothing when the browser asks to save data). A saved
  identity is the current one while the start opens its space (`createAppRoot` gives the
  services at once and the open as `opened`): its frame and its screen render, and what is read
  or written meanwhile waits for the space (`SpaceSource.opening`); the identity's database opens
  in its worker while the space's code loads. The app starts only once the page's localStorage and
  the tab's sessionStorage each kept a value and gave it back (`siteStorage`): a browser that
  blocks site data stops at a message that says so, instead of forgetting who signed in, the
  device's id and the updates the tab already loaded the page again for. A saved identity whose
  space does not open stops the start too, and the shell offers to sign out on this device
  (`SessionService.signOutUnopened(identity)`), of that identity alone and only while it is still
  the saved one: its session token is left to sign out and its databases deleted,
  so a database that will never open is no dead end. Signing up asks the gateway to create the
  account and mail its verification link (`SessionService.signUp`, the gateway's own
  `POST /backend/auth/sign-up/email` with the name, the email, the password and the language the
  app speaks, naming no device): it answers 202 alike whether the email is new or has an account,
  signs nothing in and changes nothing in the session; a 400 or 422 is `data:SIGN_UP_REJECTED`, a
  429 `data:RATE_LIMITED`. Signing in goes through the gateway (`gatewayAuth`: Better Auth's
  client over `POST /backend/auth/sign-in/email` on the page's own origin, the device in
  `X-Perch-Device` and `X-Perch-Device-Label`; the device keeps the raw session token of the
  answer's body, never the signed one of its `set-auth-token` header; a 401 is
  `data:INVALID_CREDENTIALS`, a 403 `data:ACCOUNT_BANNED` when its body names `account-banned` and
  else `data:EMAIL_NOT_VERIFIED`, a 409 `data:DEVICE_LIMIT` (the
  account is signed in on as many devices as it may be: nothing is signed in, and the sign-in page
  asks before it signs in all the same with `signOutOldest`, which signs out the account's device
  seen least recently), a 429 `data:RATE_LIMITED`, and the
  sign-in page says to wait; an unreachable gateway is `data:OFFLINE`, keeping nothing of what the
  request carried).
  A verification link's token signs the device in the same way the first time it is exchanged
  (`SessionService.verifyEmail`, the gateway's own `POST /backend/auth/verify-email` with
  `{ token }` and the device's headers, its answer read through a zod schema): in the same lock,
  kept and opened as a sign-in, and answered with the account's name and its sign-up language; as a link
  names no email, another account saved on the browser refuses it (`data:OTHER_ACCOUNT`) only
  once the gateway answered, and its new token is left to sign out. A link verified before signs
  nothing in (`verified-before`), the link of an account an operator banned verifies its email,
  signs nothing in and fails as `data:ACCOUNT_BANNED` (a 403 that names `account-banned`), and a
  refused one fails as `data:LINK_EXPIRED` or `data:LINK_INVALID`, naming no token. The account a first verification signed in starts on
  this browser (`composition/account-starts.ts`, the user module's `AccountStartService`): its
  start is kept in `perch.session.account-start` (the identity, the name and the sign-up
  language) until its settings (in that language and the theme the device shows as it creates
  them) and its profile both exist, and finished each time that identity's space opens here
  again. The tabs take their turns under the Web Lock
  `perch.session.account-start` (`oneTabAtATime`, the helper the sign-in lock runs on too): each
  reads the kept start and the account's records afresh in the local store they share, and
  leaves what it wrote durable and projected before it lets go, so no tab creates a record
  another one created. A sign-out forgets the kept start with the device (`forgetDevice`); a
  session that only closes (a tab that goes) keeps it for the next open. A start that a sign-out
  left unfinished stays so until a sign-in learns of it: a sign-in whose answer carries `start`
  (`{ name, locale }`: the account has no settings or profile at the gateway yet, because a reset
  verified its email or the device that verified it has not synced its start) keeps that start
  before the device is saved (`SessionOptions.keepAccountStart`), marked `afterPull`; such a start
  is not finished as the space opens, but by the tab that leads the sync once its engine says the
  account's private region caught up with the gateway on this connection
  (`SyncEngine.caughtUp(privateRegionId(identity), …)`: the welcome named it, it still syncs, its
  subscription was answered and every update since was imported in full, none lost and none
  waiting for its history; a region that stopped or that the welcome left out never catches up,
  and the start waits), so it creates only what the pull left missing and never races a record
  another device created and changed meanwhile. Every start's turn first projects what the tab's
  documents hold, pulled updates included, before it reads the store, and a create the document
  refuses for a record it holds after all counts as done once the projection shows it; a start
  that failed after the pull is tried again `START_RETRY_MS` (5 seconds) later on the same engine. Until then the account shows what it has, its
  profile page's empty state when the profile is missing. `resendVerification(email)` asks
  `POST /backend/auth/send-verification-email` for the mail again (202) and changes nothing in
  the session. `requestAccountDeletion(password)` asks
  `POST /backend/auth/request-account-deletion` with this device's session token for the mail
  whose link deletes the account (202; the account stays as it is), and `deleteAccount(token)`
  sends that link's token to `POST /backend/auth/delete-account` with no session (200): both read
  a 409 `last-admin` as `data:LAST_ADMIN`; the request reads a wrong password as
  `data:INVALID_CREDENTIALS`, the deletion a link the gateway refuses as `data:LINK_EXPIRED` or
  `data:LINK_INVALID`. The gateway ends the deleted account's sessions and its 200 names the
  account (a 200 that does not is `data:AUTH_FAILED`): a session open here for that account signs
  out at once as on the channel's 4001, which a browser without Web Locks never hears, and
  another account signed in here stays. Until the sign-in is whole its token
  stays in memory: the session reads the memberships with it and the device it named
  (`GET /backend/organisations`, `listMemberships(token, device)`), then, while the session is
  still open and no other tab saved another account, saves the memberships, the token and the
  identity in one step (the identity last, which the other tabs follow) and opens the space. A
  read that fails, a session closed meanwhile or another account saved meanwhile fails the
  sign-in and leaves this attempt's token to sign out, and so does a throw while the attempt
  holds its token (the read, the save: `data:AUTH_FAILED` naming nothing of the throw; the token
  is left to sign out first, then a save it broke off is undone while the saved token is this
  attempt's, neither step stopped by a throw of the other); a space that then does not open lets
  go of the token the same way: left to sign out first, then the device forgotten only while the
  saved token is still this attempt's, never another tab's (an open or a cleanup that throws fails
  the sign-in as `data:AUTH_FAILED` naming nothing of the throw; a session closed meanwhile keeps
  the saved device whole for the next start). The tabs of a browser sign in one at a time, under the Web
  Lock `perch.session.sign-in` held from the request to the saved device (not through the
  space's opening): a later sign-in asks the gateway only once the earlier one saved, so the
  storage ends with the live token (the gateway's later sign-in ends the device's earlier
  session). A sign-in or a verification names the
  device: the browser's own id (`perch.device.id`, minted once and kept across sign-outs, and
  minted again when the stored value is not a device id of 1 to 64 characters) and a
  label read from the user agent (`deviceLabel`: "Chrome on Linux", "Safari on iPhone",
  "Browser on device" when it cannot tell, at most 60 characters); the sync channel names the
  same id in its hello and every organisation call sends it as `X-Perch-Device`. The
  identity, its session token (`perch.session.token`, kept until a sign-out together with the
  identity it was issued to, `{ identity, token }`: the calls made for an identity, its own, the
  organisation and device routes' and its channel's, read the token through its owner in one
  step, never another account's that another tab saved since)
  and its memberships (`perch.session.memberships`, the current tenant in
  `perch.session.tenant`) are kept in local storage, and the identity's space opens
  (`openIdentitySpace`: database `indxdb://app-identity-<id>`, region `identity:<id>`,
  projector, write path), with a database of its own for each organisation the identity
  belongs to (`openTenantSpace`: `indxdb://app-identity-<id>-t_<key>`, region `tenant:<key>`;
  `TenantSpaces` keeps them in step with the memberships). The tabs of a browser open a database
  one at a time, under the Web Lock `perch-open:<database>` (`openOneAtATime`): two engines
  setting up the same new database at once conflict and one open fails. Reads and writes are routed by
  region (`RoutingShapeRunner`, `RoutingWritePath`): a shape over the tenant region's tables
  and a command into the tenant region go to the current organisation (the one selected on
  this browser, otherwise the first by key; none refuses with `no organisation is selected`),
  everything else to the identity's own database; a watch over the tenant region moves to the
  organisation that becomes current (or reports that none is). A reload opens the saved identity's space
  without the network. The session follows the memberships (`SessionOrganisations`): from the
  read after the sign-in, from the leading tab's channel (the welcome and each `memberships` message)
  and from the other tabs through the storage; an organisation database that does not open, at
  the start or at a change, is reported and left out (the organisation stays a membership,
  unavailable on this device: not current, not selectable, not synced, and the changes it may hold
  count as unsent, so a sign-out asks before it deletes it and never has the gateway revoke the
  device meanwhile) until the next change of memberships asks for it again, so one broken
  database never blocks the others; a new organisation's database opens, the
  database of one the identity left is deleted, and a leading tab syncs the regions on a new
  engine (`LeadingEngine`); a sign-out draining through the old one then ends `offline`. Every organisation database the device holds for the identity is counted in
  `perch.session.tenant-databases` (`{ [identity]: keys }`, each identity's count apart, so
  another identity signing in on this browser leaves it as it is) before it opens, and stops
  being counted once deleted; the count outlives the token, so whenever the space opens or follows
  the memberships, a counted database of an organisation the identity no longer belongs to is
  deleted even when it is not open (`deleteTenantLocal`): one kept across a sign-out that kept
  the databases, or one that failed to open. The memberships are saved before their databases
  are counted, and a tab deletes none whose organisation the memberships saved for the identity
  still hold, so a tab following an older list leaves alone a database another tab counted and
  opened for a newer one. The account's platform roles (`operator`, `SessionRoles`) are kept
  per identity, a record each (`perch.session.roles.<identity>`), written only from the welcome
  the leading tab's channel hears (the browser's and the seed's transport, `syncTransport`, hand
  the session's context the welcome's memberships and roles and the channel's end) while that
  identity is still the one signed in on the browser, a welcome without a role taking it away;
  the other tabs follow a record through the storage, reading it and writing nothing; a sign-in
  or a verification brings none; the sign-out removes the signed-out identity's record, and a
  record of another identity is never read as the signed-in one's. A region space can replace
  its document (`replace`: `reset` drops the
  region's local copy, `reopen` opens it again from the database), refusing writes meanwhile;
  the projector then re-reads the new document. The leading tab's engine has the region space
  reset a region whose batch the gateway refused again after its rollback, and then loads it
  from the server; when a tab resets a region the other tabs reopen it (`RegionReloads`), on the
  `reset` hint or at their next touch of the region (a catch-up or a write that meets
  `data:REGION_STALE`). The routes that act for the signed-in device go through
  `bearerCalls(baseUrl, { token, device })`: the session token as `Authorization: Bearer`
  and the device's id as `X-Perch-Device`, sent once (a 401 is `data:AUTH_FAILED`: the token is
  dead), refusals mapped to
  `data:` errors (the gateway's code as the message of `data:WRITE_REJECTED`, a 429 among them,
  which the organisation page words as "too many attempts"; any other status
  named without its body). `organisationsApi` calls the gateway's `/organisations` routes with
  it; the `ORGANISATIONS` port (`createOrganisations`) makes an organisation the identity
  creates its membership on the device at once, adopted only into the space that asked (the
  adopter is taken from the session before the request), appended to the newest list any tab
  kept when that list does not name it yet, never replacing an entry another list wrote; the
  invitations of an organisation (an invite with a role, the pending ones, a revocation) and a
  member's role change (`PATCH` of the member) adopt nothing: every device of the member learns
  the role over the sync channel. `invitationsApi` is the `INVITATIONS` port over
  `POST /invitations/read` (the link's token in the body, with the session token only when the
  device holds one: `jsonAsWhoever`), `GET /invitations`, `POST /invitations/accept` and
  `POST /invitations/decline` (`createInvitations`: an accepted invitation is the membership on
  this device at once, adopted as a created organisation is, and the answer comes once it is
  adopted, so the service selects the organisation then; a 410 is read as a refusal code like a 409). `devicesApi` is the `DEVICES` port over
  `GET /devices` (each device's session row id, label, times as dates, `revokedAt` when signed
  out, `current` for this device; the browser's own id is never sent back),
  `DELETE /devices/:id` and `POST /auth/sign-out-everywhere`. `accountsApi` is the `ACCOUNTS`
  port over the console routes `GET /console/accounts?q&page&size` and
  `GET /console/accounts/:id`, for an operator: each request reads the tab's credentials once as
  it starts (the identity it shows and the token saved for it), each answer is parsed and each
  refusal is a code of its action (`failed` for any other), and a `not-operator` takes
  `operator` off the roles saved for that identity (`SessionService.dropRole`), whichever
  identity is shown by then. One tab per browser leads the
  identity's sync through a Web Lock and runs the sync engine over the gateway's WebSocket
  (`/backend/sync`, its hello presenting the session token) for the private region and every
  organisation's; the tabs hint each other over a BroadcastChannel, so each reads what the others
  wrote or imported. Signing out takes the lead, drains, has the gateway sign the device out, then
  forgets the token and the memberships and deletes the identity's database and
  every organisation database the device holds for it, open or not, and the count of them; with
  changes it could not send it asks first. The identity is listed in
  `perch.session.leftover-identities` before its databases are deleted and taken off once they
  are gone (`SpaceDeletion`); a delete another tab still holds up after 5 seconds (it keeps the
  database open) goes on without the sign-out, whose tab then hears of it, and the sign-in page
  says the data leaves the device once the other tabs are closed, unless an account signed in on
  the browser since the session ended: each word left for the sign-in page names the last sign-in
  before the session ended (`perch.session.notice.<sign-in>.<code>`), and a sign-in ends every word naming
  an earlier one as it is kept (`perch.session.sign-ins`), a late one included. Each start deletes the
  databases of the identities still listed, but the one signed in, and opening an identity's
  database waits for a delete of it that the page runs. A sign-out the gateway did not confirm (offline, or
  giving unsent changes up, or kept by a frozen tab while offline) leaves the session token, whose
  session still lives, with the device it signed out, in `perch.session.pending-revoke`: one list
  for every account signed out on the browser, so another account's offline sign-out adds its
  token after the ones waiting (at most 8: one more drops the oldest, which is reported; a key
  pair an older build kept there is skipped). A token a sign-in was given but does not keep is
  kept there first, then sent on its own at once while the browser is online and forgotten once
  the gateway took it, so a page closed meanwhile leaves it for the next start. A token the
  browser's storage refuses to keep (its quota full: the write is
  dropped) is held in memory for the page's lifetime, tried first by every send, and reported
  without the token. The tokens are sent at once while the browser is
  online, else at the next start online, and in any case before the next sign-in, one after the
  other, to `POST /backend/auth/sign-out` (the token as `Authorization: Bearer`, its device in
  `X-Perch-Device`, no body), and each is forgotten on its own answer: once signed out (204),
  refused as dead (401) or refused otherwise (any other 4xx, which the gateway will never take:
  reported); an unreachable, failing (5xx) or waiting-asking (429, `data:RATE_LIMITED`) gateway
  leaves that token for the next try, a 429 without a report. A token whose send or
  report throws is kept, the throw reported, and the tokens after it are sent all the same; a
  send that fails, even by a throw, never stops the next one. A report names a code and a message,
  never a cause or a token, and the page logs an error by its code and message only. While a sign-out runs, no tab of the browser
  takes a write (a `sign-out` hint and the `perch.session.signing-out` mark, which lapses after a
  minute, hold them back), and every write a tab admits holds the Web Lock `perch-write:<id>` shared
  until it is durable; before it reads what is unsent and deletes, the sign-out takes that
  lock exclusive, waiting for writes admitted earlier, and keeps the database (as after
  a refused token) when it does not get it within 10 seconds (`WriteBarrier`). A change that still
  landed after the final drain keeps the database. A
  sign-out that asked the gateway in vain (no sign-out close) stops the engine's channel; when
  it leaves the person signed in, the leading tab syncs again on a new engine
  (`IdentitySpace.resumeSync()`), as a change of leader does. A session token
  the gateway refuses signs the device out locally, behind the same barrier and lock: the
  identity's database goes with it unless it holds changes not sent yet, in which case it
  stays (as after such a sign-out) and the sign-in page says to sign in again (as the same
  identity) to send them. A device signed out from another one (its channel closed with 4001,
  the transport's `revoked` ending) signs out the same way, and when its database goes the
  sign-in page says "You were signed out from another device."; the device keeps its id, and
  the dead token is not left to sign out. A device that asked the gateway to sign every device out
  signs out the same way as soon as the gateway answered (`SessionPort.signingOutEverywhere()`,
  which names the asking session before the request goes), without waiting for a 4001 it may
  never hear (no Web Locks, or no WebSocket); whichever of the two comes second finds nothing
  left to do, and an answer that comes once the asking session has ended (another account, or
  the same one, signed in since) signs nobody out. A forced sign-out that finds, once no tab
  writes any more, a token another tab saved since it began (a sign-in made there meanwhile, of
  the same account or another) forgets nothing and deletes nothing: this tab leaves its space and
  follows that sign-in. A write that waited for the lock goes on only into the
  space it was admitted for, still open, and while no sign-out runs. A
  protocol the gateway refuses (4400) stops the sync and keeps everything; the session publishes
  it and keeps it until the page loads again (`protocolRefused()`), so that the frame offers to
  load the page again even when it starts listening later. One account per browser: a
  tab follows another tab's sign-out by closing its space and another tab's sign-in by opening
  the space of the identity it saved (the sign-in page then moves to the profile, unless the
  sign-in is its own); an identity the tab shows without its space (the start opening it, or
  done without opening it) leaves at once when another tab signs it out, not behind the open,
  which then attaches nothing, and the frame goes on as a guest's. A sign-in that finds another
  account saved is refused with
  `data:OTHER_ACCOUNT` ("Sign it out first"), before it asks the gateway, or after it when
  another tab saved one meanwhile, whose new token is then left to sign out. A new password set
  through a reset link writes `perch.password.reset` once the gateway took it, a fresh value each
  time that names no account, so the browser's other tabs hear of it (`PLATFORM_EVENTS`, below).
  The reset presents this device's session when one is open, and the gateway's 200 says whether
  that session was among those it ended (`{ signedOut }`; a 200 that does not is
  `data:AUTH_FAILED`): when it was, the session signs out here at once as on the channel's 4002,
  which a browser without Web Locks never hears, unless the browser keeps another token by then
  (a sign-in made since, in another tab too); another account signed in here stays. The
  container's runner and write
  path follow the current space and refuse while nobody is signed in. The command bus
  logs each command, validates its params and sets the execution context (actor, device
  and correlation ids). The root makes the app's domain event bus (`app-events.ts`: `EventBus` of
  `@workspace/cqrs`, provided as `EVENTS`) and is its only publisher: the command bus
  publishes `<command id>.done` or `.failed` once the write path resolved (a failing
  subscriber is logged, never the command's failure), the session publishes
  `sync.change-rejected`, `sync.changes-reloaded` and `sync.protocol-refused`, and a
  development build logs every event's name. The root also provides `SERVED_BUILD`
  (`served-build.ts`): the build the server serves, read from the UI manifest it serves
  (`/ui-manifest/manifest.json`, never cached) when the frame starts watching, each time the tab
  comes back to the foreground and every ten minutes while it is there, against the build this
  tab runs (`virtual:perch-build`, below); a manifest the server does not serve, or a failed
  read, says nothing. It provides `CLIPBOARD` too (`browser-clipboard.ts`): the browser's
  `navigator.clipboard.writeText`, which an administrator's copy of an invitation's link goes
  through; a page that is not a secure context has no clipboard, and a write then fails naming
  it, as the browser's own refusal does. And `SYNC_STATUS` (`sync-status.ts`): the state of this device's sync for a
  signed-in account, the same in every tab: the leading tab shares its channel, whether its
  space holds unsent changes and a sync stopped for good as the record `perch.sync.leader` in
  the browser's storage, written on each change of its channel and every two seconds while it
  leads (it says synced only once a read of the outbox, asked in its current leading period and
  not overtaken by a later one, found nothing waiting); every tab reads it with its own network
  (`onOnlineChange`), and a record nobody refreshed for six seconds belongs to a leader that went
  away. The leading tab's sync channel hears the same network (`browser.ts` hands it to
  `WebSocketTransport`): once the browser is back online it connects at once instead of waiting
  out its backoff. And `PLATFORM_EVENTS` (`platform-events.ts`): the platform's events that reach the
  screens' machines and the frame's, from the facts of this browser no account owns, each a key
  of its storage another tab set (`perch.password.reset` tells `platform.password-reset`,
  `perch.theme` tells `platform.theme-set`); the storage's own
  event keeps it from echoing (a tab never hears its own write, a write that changes nothing and a
  value kept before the tab opened tell nothing), and a key removed elsewhere tells nothing either.
  `<html data-boot-step>` shows the boot step; `data-sync-leader`
  and `data-sync-channel` show the tab's sync role and channel.
- `src/platform/`: `defineModule`, `ModuleScope`, `useService`, `useShape`, the router built
  from module routes (each page inside its module's scope; after its guard a page opens only for
  a device holding one of its `roles`, its binding's, read by `held-roles.ts` as the UI contract's
  `heldRoles`: `guest`, or `identity` with the role in the organisation current and the account's
  platform roles; any other device gets the page of the module route at `/$` in its place at the
  same address, its search never read, which the frame names and marks as the not-found screen,
  `resolved-route.ts`; a page left open is checked again
  whenever the account changes: a protected page sends one signed out to sign-in, a guest page
  one another tab signed in to the profile, while a sign-in of this tab's own,
  `SessionPort.signingInHere()`, leaves a page that signs in (the sign-in page, a verification
  link's) to its flow, which goes on to its welcome, any other page open meanwhile checked at
  once; and whenever the roles the device holds change, outside such a sign-in on such a page), the ports for the session (with the memberships, the current organisation and the
  account's platform roles), for commands, for the app's events (`events.port.ts`:
  subscribe, once, onAny), for organisations, for devices, for the build the server serves
  (`served-build.port.ts`), for the state of the sync (`sync-status.port.ts`) and for the
  platform's events that reach the screens and the frame (`platform-events.port.ts`, sent to a
  running machine by `platform-events-input.ts`, `sendPlatformEvents`, the one way both hear them),
  the notice and the toasts the shell shows (each raised by its contract code, the frame
  giving the words: `notices.tsx`, `toasts.tsx`, `texts.ts`), the language state and the
  app-wide catalogs, and the theme of this device (`theme.ts`: light, dark or the system's own,
  kept in this browser under `perch.theme` as the theme this device showed last, shown as the
  class `dark` on `<html>` and following the device's setting under the system's; a guest's choice
  and the account's theme a signed-in tab shows are kept there, and `follow()` shows one another
  tab kept, keeping nothing itself; the start makes it before the first frame and gives it to
  views through `ThemeContext`, read with `useDeviceTheme()`), and this tab's own writes of
  the account's settings (`settings-writes.ts`: the settings screen's store of a setting tells the
  frame of each write before it starts and when it failed, `trackedStore`, so a late echo of an
  earlier write is not taken for a value another tab or device stored; the start provides them
  over the frame's record). `ui-contract.ts` is
  the page helper of development and e2e builds: `main.tsx` installs it when the build
  constant `__PERCH_UI_HOOKS__` is true (`vite.config.ts`: development mode, or
  `PERCH_UI_HOOKS=1`, which the e2e launcher sets), and `window.__perch.ui.anchors()` then
  lists every `data-testid` the page renders now with its kind, `data-state`, `data-code`,
  `data-id`, `data-value` and whether it is visible, with the page's URL
  (`renderedAnchors(document, location)`, `installUiHelper(window)`). A route's `search` (a
  Zod object) validates the URL's search, drops a parameter equal to its default and carries
  the `retain` parameters across navigations. `install.ts` installs the app on this device for
  the frame's reminder: Chromium's `beforeinstallprompt` (its window opened by `prompt()`),
  Safari on an iPhone or an iPad by the user's steps, the reminder put off for three days
  (`perch.install.later`) or ended once installed (`perch.install.installed`, `appinstalled`, the
  app running standalone); the start makes it before the first frame and gives it through
  `InstallContext`. `routes-contract.spec.ts` proves every module
  route equals its binding in the screen files of `contract/domain/screens/` (path, guard, roles
  as a set, history, retained parameters, and the input view of the search schema as JSON
  Schema, without its prose); `routes-roles.spec.ts` opens every routed binding for a guest, an
  account, a member, an admin and an operator, at its example and at a search it refuses, and
  holds what each sees to the binding's roles and guard;
  `routes-router.spec.ts` builds every binding on the real router (the contract's sample of
  each parameter of its path, `parameterSample`, and the least search its schema accepts),
  matches it back to the same route, parameters and search with the defaults applied, and
  holds the binding's `params` to the parameters of its path; `routes-examples.spec.ts` holds
  each binding's example link to the router (the path it builds, the search string it
  writes, the route, parameters and search it matches) and the router's route tree to the
  tree of the screen folder, both specs on the router of `__fixtures__/router.ts`.
  `machines.spec.ts` holds the app's own machines for a screen (`APP_MACHINES`) to their
  flows with the engine's comparison (`@workspace/ui-contract/machines`), one way on a branch
  (`CONTRACT_AHEAD=1`: a machine may lack what its flow just added, or still be its flow at the
  branch's base or at the branch's HEAD, the contract it was built from,
  `__fixtures__/machine-flows.ts`); running every flow and
  activity in XState is the contract check's, not the app's.
  The guard of unsaved input: `leaving.ts` holds `LEAVE_POLICY`, how each leave that would
  lose what was typed asks (the platform's `unsavedInput`), and `LEAVING_CONTROLS`, the
  anchors bound to an action of `leaving`, both held to the contract by
  `leaving-contract.spec.ts`; `leave-guard.port.ts` is how a screen asks the frame before such
  a leave (`useLeaveGuard()`: `confirm()`, `before(control)`; every leave goes ahead without
  a provider). The question before a destructive action: `confirmations.ts` holds
  `ASKING_CONTROLS`, the anchors that carry `asks` with their codes, held to the contract by
  `confirmations-contract.spec.ts`; `confirm-guard.port.ts` is how a screen asks the frame's
  confirmation before such a control (`useConfirmGuard().before(control)`; every action goes
  ahead without a provider); `screen-machine.ts` is the one way a screen runs its machine
  (`useScreenMachine(screen, machine)`, `screen` the id of the contract's screen whose flow
  it runs: the flow's `navigate` effects pass the guard, their search
  taking each `{ anchor: <field> }` from what the moving event carries in its `fields`, an empty
  field left out, and each `{ item: <item> }` from its `items`, the id of the entry acted in
  (`navigate-search.ts`, the effects' params in `flow-effects.ts`), a destructive
  control's event waits for the confirmation and a leaving control's for the guard, and `submit(event)` resolves with the outcome of the actions
  the event started, and of the ones they started in turn, judged apart from any other submit
  or actor; `false` when the state does not take the event; the platform's events reach the
  machine while it runs, each carrying what the screen's fields hold, as the container gives them
  (`useScreenMachine(screen, machine, fields)`), for a move it makes, and a state that does not
  handle one lets it pass; `renders(anchor)` says whether the state renders an anchor, read from
  the machine, whose states carry their flow's `meta.renders` (`screen-renders.ts`: `rendersIn`
  over the engine's `renderedAt` and `isRendered`, which the frame's shell reads too), so a view
  shows an anchor only some states render where the state renders it, never by a list of states
  of its own; in development and e2e builds each state of `screen` the page settles in (React
  committed it, the browser painted it, every animation that ends has ended, and the machine is
  still in it) goes to `window.__perchSettledState` when an e2e run exposes it
  (`settled-report.ts`: `useSettledReport`, which the frame calls as `app-shell` from
  `main.tsx`, and `reportSettled` over the page); and the flow's effects on the
  frame run through `frame-effects.ts`: a `show` on `app-shell.toast` pushes a toast, one on
  `app-shell.notice-message` sets the notice, a `clear` of it clears it, one on
  `user.sign-in.notice-message`, from any screen, leaves its word for this tab's next sign-in
  page (`SessionPort.leaveNotice`: a fact of this tab's move, kept in its memory, never in the
  browser's storage; the page reads it with the browser's words, `perch.session.notice.<sign-in>.<code>`,
  says the first by the rank the contract gives the anchor's codes, `SESSION_NOTICES`, and
  takes them all; each slot holds the words left since the last sign-in on the browser, which
  ends the browser's as it is kept), one code each, and a `clear` of it, the frame's on a sign-in
  heard (`platform.signed-in`), drops this tab's own word left before that sign-in
  (`SessionPort.dropNotice`), however late it is heard, while
  a screen's own anchors stay its container's to read); `search-start.ts` is a field's binding
  `{ search: <name> }` (`useSearchStart(name)`: the value of that search parameter when the screen
  opened, read once, so the field then holds what is typed), and `search-value.ts` one that
  follows the address (`useSearchValue(name)`: the value again each time the route's search
  changes, what was typed meanwhile dropped); `use-listed.ts` is a list read from the platform
  (`useListed(read, scope, changed, { source, search })`: read when it shows, when the flow
  reads it, and when its scope or a search key its source reads changes, a read for an earlier
  one dropped), and `page-moves.ts` the moves of a paged list's parts (`usePageMoves(search,
  defaultSize)`: the address of a page and the move there, the search and the size kept, and the
  move to the first page of a size chosen, which writes that size as it is, the default included,
  so the router's strip takes a default out and its `retain` never gives an earlier size back).
- `src/features/<feature>/`: one module per folder, each with its own README for its role,
  surface (routes, shapes, commands, providers) and commands; details live there, not here:
  - [app-shell](src/features/app-shell/README.md): the page frame, navigation and notices.
  - [user](src/features/user/README.md): accounts, sign-in and the identity's profile.
  - [organisation](src/features/organisation/README.md): memberships, members and the
    shared notes of the tenant region.
  - [device](src/features/device/README.md): My devices, signing one device or every one
    out.
  - [console](src/features/console/README.md): the operator's console of the platform's
    accounts.

## Key exports

`./seeding`: `openClient({ gatewayUrl, inbox })`, a device of the application in Bun or Node
(the composition root over an in-memory database, always leading its identity's sync, named
"Seed client" with an id minted into its memory storage) whose `ensureAccount` signs an account
in through the gateway, or signs it up and verifies it through the link of its mail, which it
reads in `inbox` (an `Inbox`: the stand's mailbox; an account not verified yet has its mail sent
again, and an email that has an account with another password fails as invalid credentials, as
a sign-in does, without waiting for a mail), writes its profile and settings through commands
and waits until the gateway acknowledged them, and whose `readAccount` signs in and reads the
profile the gateway sends; one device, it signs the account it is in out before it
enters another (one account per device), and stays in the last one. As the
signed-in account, `ensureOrganisation` creates an organisation (one the account already
administers is found; one it only belongs to is refused), `ensureInvited` invites an existing
account by email as a member and answers the invitation's id (`already-member` when it is one),
`ensureJoined` accepts an invitation by its id as the signed-in account, and
`readOrganisation` signs in, makes the organisation current and reads its notes. Its HTTP calls
of the gateway go through `fetcher` (`openClient({ gatewayUrl, fetcher })`, the global `fetch`
by default), which a test talking to the gateway directly uses to name a client address in
`X-Forwarded-For`, as the front would. `openStand()` is the operator's connection to a stand as a system user, where seeded
accounts and the organisations they created are swept; it applies the directory schema as the
gateway does, which leaves a stand that already has it alone. `openStandTenant()` opens an organisation's database on the stand the same way. `checkProfileName` is the profile name rule the seed catalog is checked against. Entry point `src/main.tsx`; `src/modules.ts` lists the feature modules;
`src/test-utils.tsx` renders components with the application providers.

## Commands

- `bun run dev`: the build watcher, `vite build --watch --mode development --outDir dist-dev`:
  rewrites `dist-dev/` (source maps, no minifying) on every change, then the UI manifest into
  `dist-dev/ui-manifest/`
  (`ui-contract manifest`; a change of a file under `contract/` or `tests/e2e/scenarios/`
  rebuilds too). Every build carries the build it is, `import build from 'virtual:perch-build'`
  (`vite.config.ts`): the root package's version and the commit checked out, the product the
  manifest names; a commit or a new version rebuilds, so the bundle and the manifest stay one
  build. Every build also strips the `sourceMappingURL` custom section from the WASM it emits
  (`build/wasm-source-maps.ts`, in the main and the worker bundles): loro-crdt ships its module
  naming a source map on a CDN, which DevTools would ask for and the front's policy block. And
  every build writes the web app manifest and the service worker (`build/pwa.ts`,
  `vite-plugin-pwa`): the icons are `public/icon.svg` with its PNG sizes; the worker caches the
  page (as `/offline-shell`, an address nothing links to) and its hashed scripts and styles when
  it installs, answers a page load from the network and only offline from that cached page,
  serves hashed files from the cache first, caches each
  WASM module the first time it loads, and never caches `/backend/` or the UI manifest. Only a
  production build registers it (`src/composition/service-worker.ts`, from `main.tsx`), so the
  dev stand runs without it and the e2e stand (a production build) has it. There is no dev server: the dev stand's Caddy front serves `dist-dev/`, so
  reload the page after a rebuild; `dist/` is the production build's alone.
- `bun run build`: production build into `dist/`, then `ui-contract manifest --out
  dist/ui-manifest`: the UI manifest built from `contract/` and the scenario files, once the
  contract check passes, with its schema and the model's beside it, which the stands serve at
  `/ui-manifest/`. With `PERCH_UI_HOOKS=1` the build installs the page helper. A production
  build fails over its size budgets (`build/size-budgets.ts`, gzipped): the first frame (the
  page, the scripts and styles it names, its Basic Latin font) 310 kB, each lazy script 100 kB,
  the SurrealDB WASM 5.2 MB and the Loro WASM 1.2 MB, and a WASM module without a budget fails
  it too; otherwise it prints how close it came.
- `bun run test`: composition, platform and component tests.
- `bun run model` / `bun run model:check`: generate or check the models of `.surql` files.
- `bun run i18n:check`: translation keys against the catalogs.
- `bun run typecheck`, `bun run lint`.
