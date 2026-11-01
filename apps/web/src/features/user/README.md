# Accounts and profile (module `user`)

## Role in the architecture

The platform's account module: signing in or creating an account, and the signed-in
identity's own profile and settings. Both live in the identity's private region: they are
read and written on the device and kept in step across devices through the gateway; the
profile is the account's face, the settings what the app is like for it (today its language),
never read by anyone else. Layers:
`domain/` holds the profile entity (schema and bounds) and one file per rule
(`profile-name.rule.ts`, `profile-bio.rule.ts`, and `password-confirmation.rule.ts`: how the
password typed again at sign-up stands to the password, the same, following while it is how the
password begins, or strayed); `application/` the `SignInService` over the
session port, the `VerifyEmailService` over the session port and the account's start (it
exchanges a verification link's token; the first verification, which signs this device in,
starts the account there, and a link verified before starts nothing), the `AccountStartService`
over the profile and settings services (the account's settings in the language it signed up in,
then its profile with the name it signed up with, each created only where the device holds none,
under an id derived from the identity, so the account never has two; the start is kept on the
browser until both exist and finished when the account's space opens there again, the browser's
tabs taking their turns so that one tab never creates what another created; the composition
root provides the service app-wide and runs that finish; a sign-out forgets an unfinished start,
which then stays unfinished: later sign-ins do not finish it, and the profile page shows its
empty state when the profile is missing), the `ProfileService`
over the shape runner and the command bus, the
`SettingsService` the same way in its own component folder `application/settings/` (its shape
and commands beside it), the sign-in
machine in its folder `application/sign-in-machine/` (the flow of
`contract/domain/screens/sign-in.yaml`: the mode is its state, an attempt invokes
`platform.sign-in`, `platform.sign-up` or `platform.resend-verification`, at sign-up it holds the
password to the rules of a new password (the kernel's `keepsPasswordRules`, the gateway's too)
and compares the password typed again as either password is typed and on the switch into
sign-up, it keeps the codes of the form's error and mail message, and the address the last
sign-up or resend mailed, and emits `show` and `navigate` for the page; `machine.ts` builds it,
`guards.ts` holds the flow's guards, `events.ts` and `context.ts` what it takes and keeps), the
verify-email machine (the flow of `contract/domain/screens/verify-email.yaml`: it starts by
invoking `platform.verify-email` with the token of its address, given when the page builds it;
the first verification shows the frame's `welcome` and moves to `/me`, a link verified before
ends on its message, a refused one offers `platform.resend-verification` to an email typed; it
keeps the codes of the page's error and message, and the address the last resend went to)
and one file per policy (`profile-name.policy.ts`, `profile-bio.policy.ts`,
`locale-change.policy.ts`); `presentation/` the pages, their views and the i18n catalogs.

## Surface

- Routes: `/sign-in` (guard `guest`) renders `SignInPage`; `/verify-email` (guard `guest`,
  search `token`) renders `VerifyEmailPage`, the page a verification mail's link opens: it runs
  its screen's flow as its machine through `useScreenMachine`, over the token of its address (none
  is an empty one, which the session refuses as `data:LINK_INVALID` without asking the gateway).
  The exchange of a token is kept by the mounted page: React's StrictMode restarts a mounted
  screen's effects once in development, which starts the machine's first invoke again, and the
  gateway signs a device in only at a link's first exchange, so the restart reuses the exchange
  already started; a page mounted anew (a later visit, a revisit after a sign-out or after a
  failed exchange) asks afresh, and another token in the address of the open page starts another
  exchange with its own machine (the part of the page that runs it is keyed by the token). `/me` (guard `authenticated`)
  renders `ProfilePage`; `/settings` (guard `authenticated`) renders `SettingsPage`: the theme of
  this device (the platform's `useDeviceTheme`, `platform.theme.set`; the frame's theme select
  chooses the same one) and the account's language
  (stored through `settings.updateLocale`, spoken at once), its screen's flow run as its machine
  (`application/settings/settings.machine.ts`, held to `contract/domain/screens/settings.yaml` by
  `platform/machines.spec.ts`) through `useScreenMachine`, which asks the leave guard before the
  language changes.
- Shape `profile.shape.surql`: the signed-in identity's profile (`id`, `name`, `email`,
  `bio`, `created_at`) from `profile` in the private region.
- Commands `profile.commands.surql`: `createProfile`, `updateName`, `updateBio`.
- Shape `settings.shape.surql`: the signed-in identity's settings (`id`, `locale`) from
  `settings` in the private region, one row per account.
- Commands `settings.commands.surql`: `createSettings` (where the account's email is first
  verified, with the language it signed up in), `updateLocale`. Commands run on the device through the command bus and
  replicate through the gateway like every command.
- Providers: `PROFILE_SERVICE`, `SIGN_IN_SERVICE`, `VERIFY_EMAIL_SERVICE`; `SETTINGS_SERVICE`
  is provided app-wide by the composition root, since the frame reads and stores the settings too,
  and so is `ACCOUNT_START_SERVICE`, since the root finishes a start as a space opens.
- i18n namespace `user.*` (`presentation/i18n/user.en.json`, `user.es.json`).
- Anchors: screens `user.sign-in`, `user.verify-email` and `user.profile` in
  `contract/domain/screens/sign-in.yaml`, `contract/domain/screens/verify-email.yaml` and
  `contract/domain/screens/me.yaml`.
- Behaviour: the page runs its screen's flow as its machine (`application/profile.machine.ts`,
  held to `contract/domain/screens/me.yaml` by `platform/machines.spec.ts`) through the
  platform's `useScreenMachine`, as the sign-in page runs its own: the flow's moves pass the
  frame's guard of unsaved input, the sign-out button asks it first, and both forms are the
  kit's `Form`, whose saved submit leaves the fields with nothing unsaved; the sign-in page
  follows another tab's sign-in with `useLeaveNow`, a leave nobody started here. The name and the bio
  (at most 2000 characters) each follow the stored value until typed into, then keep what was
  typed when another device stores another value, until it is saved (the name stored trimmed)
  or typed back; one Save writes what changed; a refused save is explained under the field its
  code concerns (the error's `fields`); Save and the sign-out button are enabled while the
  machine's state handles them; the chosen language, kept in the settings, follows the
  identity across devices (the frame stores and follows it, see the app-shell module), and a
  new account's settings start in the language chosen before signing up, sent with the sign-up;
  a sign-up lists the rules of a new password under the password (`user.sign-in.password-rule-list`,
  `password-rule-list.tsx`, the lines `user.sign-in.password-rule.*`), describing it, each rule
  marked `met` while the password as typed keeps it, its state read out with it
  (`user.sign-in.password-rule.met` or `.not-met`), and the submit is disabled while the password
  breaks a rule, the password typed again not judged until it keeps them all;
  a sign-up asks for the password twice, checked as it is typed: once the password typed again is
  no longer how the password begins, the error says so under it (`sign-in:PASSWORDS_DIFFER`,
  `user.sign-in.error.passwords-differ`, code `passwords-differ`), marking it invalid, and the
  submit is disabled until the two agree again; a submit while only a part of it was typed asks for
  nothing and says the same; the password typed again is never sent;
  a sign-up creates the account and has its verification mail sent, signing nothing in: the page
  stays on `/sign-in` in the mode sign-in with the email kept, asks to open the link of the mail
  (`user.sign-in.mail-message`, code `check-your-mail`) and offers to send it again
  (`user.sign-in.resend-button`), the message naming the address the last sign-up or resend
  mailed, which typing in the field afterwards does not change; a sign-in of an account whose email is not verified yet says so
  (`data:EMAIL_NOT_VERIFIED`, `user.sign-in.error.email-not-verified`) and offers the resend too;
  the account's settings and profile are created where its link is first opened, from the name
  and the language it signed up with; the verify page says the link is being checked
  (`user.verify-email.status`), says a link opened again is verified already beside the link to
  sign in (`user.verify-email.message`, code `verified-before`), and for a link that does not
  verify says why (`user.verify-email.error`: `link-invalid`, `link-expired`, `other-account`,
  `rate-limited`, `failed`) and sends a new one to the email typed (`user.verify-email.form`),
  saying it is on its way to the address it went to (code `check-your-mail`), which typing in the
  field afterwards does not change;
  signing out asks before losing changes this device could not send, at once when the browser
  says it has no network; the sign-in page says so when the gateway refused the
  device's session token while changes remain to send after the next sign-in, and says "You
  were signed out from another device." when this device was signed out from another one
  (`user.sign-in.notice-message` with the code `signed-out-elsewhere`), and that the data
  leaves this device once the other tabs are closed when one of them held its delete up (the
  code `delete-pending`);
  it also says to wait when the gateway limits the attempts (`data:RATE_LIMITED`,
  `user.sign-in.error.rate-limited`), and to sign the other account out first while another one
  is signed in on this browser (`data:OTHER_ACCOUNT`, `user.sign-in.error.other-account`). An
  open sign-in page moves to the profile once another tab signs someone in.

## Commands

- `bun run test` in `apps/web` runs this module's specs (`*.spec.ts`, `*.view.spec.tsx`,
  `sign-in.container.spec.tsx`, `verify-email.container.spec.tsx`).
- `bun run model` regenerates `profile.model.gen.ts` and the `.surql.d.ts` files after a
  change to the `.surql` files; `bun run model:check` verifies them.
