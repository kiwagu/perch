# Accounts and profile (module `user`)

## Role in the architecture

The platform's account module: signing in or creating an account, and the signed-in
identity's own profile and settings. Both live in the identity's private region: they are
read and written on the device and kept in step across devices through the gateway; the
profile is the account's face, the settings what the app is like for it (today its language and
its theme), never read by anyone else. Layers:
`domain/` holds the profile entity (schema and bounds) and one file per rule
(`profile-name.rule.ts`, `profile-bio.rule.ts`, and `password-confirmation.rule.ts`: how the
password typed again at sign-up stands to the password, the same, following while it is how the
password begins, or strayed); `application/` the `SignInService` over the
session port, the `VerifyEmailService` over the session port and the account's start (it
exchanges a verification link's token; the first verification, which signs this device in,
starts the account there, and a link verified before starts nothing), the `AccountStartService`
over the profile and settings services (the account's settings in the language it signed up in
and the theme the device shows as it creates them, then its profile with the name it signed up with, each created only where the device holds none,
under an id derived from the identity, so the account never has two; the start is kept on the
browser until both exist and finished when the account's space opens there again, the browser's
tabs taking their turns so that one tab never creates what another created; the composition
root provides the service app-wide and runs that finish; a sign-out forgets an unfinished start;
a start a sign-in learnt of, the account having no settings or profile at the gateway yet, is
kept by `keepAfterPull` and finished by `resumeAfterPull` once the device has pulled what the
account has, `resume` leaving it alone; until then the profile page shows its empty state when
the profile is missing), the `ProfileService`
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

- Routes: `/sign-in` (guard `guest`; search `email`) renders `SignInPage`, its email field
  starting with the address's `email`, the one a page that moved there carried over
  (`useSearchStart`); `/forgot-password` (guard `guest`: a signed-in account changes its
  password in its settings; search `email`) renders `ForgotPasswordPage`, which asks for the
  mail of a password reset (`application/forgot-password.machine.ts`, the flow of
  `contract/domain/screens/forgot-password.yaml`, invoking `platform.request-password-reset`; its
  email field starts with the address's `email`, `useSearchStart`, and the page holds what it
  holds), the same answer for any email
  (`user.forgot-password.message`, code `check-your-mail`, naming the address asked for); once
  it asked, a new password set in another tab of the browser (`platform.password-reset`, which the
  page's machine hears with the email field's value) leaves this tab's sign-in page
  `password-reset-elsewhere` and moves there with the email as typed (`reset-elsewhere`, final);
  `/reset-password` (no guard; search `token`) renders `ResetPasswordPage`, what a reset mail's
  link opens (`application/reset-password.machine.ts`, the flow of
  `contract/domain/screens/reset-password.yaml`): the new password typed twice, held to the rules
  of a new password and to the password typed again as either is typed (the guards of
  `new-password-guards.policy.ts`, shared with the sign-up), then `platform.reset-password` with
  the address's token; it ends on `password-reset` beside the link to sign in, or on a link that
  does not work (`link-invalid`, `link-expired`) beside the link that asks for a new one; a
  password refused (`password-rejected`) shows under the password, the form kept. The reset signs
  every device of the account out, this one too when it is signed in to it (its channel hears
  4002), and the page keeps its message, which its machine holds whatever the session does; the
  browser's other tabs hear of the reset (`platform.password-reset`);
  `/confirm-email` (no guard; search `token`) renders `ConfirmEmailPage`, what an email
  confirmation mail's link opens (`application/confirm-email.machine.ts`, the flow of
  `contract/domain/screens/confirm-email.yaml`): one exchange of the address's token through
  `platform.confirm-email`, kept across React's StrictMode restart as the verify page keeps its
  own (`presentation/components/link-exchange/`, `useLinkExchange`); it says the email is the new
  one (`email-changed`) and, by the account the answer names against the one signed in here, leads
  to the profile (this account: the session keeps the new email of the account signed in on this
  browser), to the sign-in page (nobody), or nowhere (another account); a refused link ends on its
  error;
  `/delete-account` (no guard; search `token`) renders `DeleteAccountPage`, what an account
  deletion mail's link opens (`application/delete-account.machine.ts`, the flow of
  `contract/domain/screens/delete-account.yaml`): the page says what goes with the account (its
  data, its sessions, the organisations it is the only member of) without naming it, and its
  button, which the frame's confirmation `delete-account` asks before, runs `platform.delete-account`
  with the address's token. It ends on `account-deleted`, beside the link to sign in for a guest
  alone, or on a link that does not work (`link-invalid`, `link-expired`) with no button; any
  other refusal (`last-admin`, `rate-limited`, `failed`) says why and offers the button again,
  the same link working again within its hour. The deletion signs every device of the account out,
  this one too when it is signed in to it, and the page keeps its message, which its machine holds
  whatever the session does; the link to sign in follows who is signed in here;
  `/verify-email` (guard `guest`,
  search `token`) renders `VerifyEmailPage`, the page a verification mail's link opens: it runs
  its screen's flow as its machine through `useScreenMachine`, over the token of its address (none
  is an empty one, which the session refuses as `data:LINK_INVALID` without asking the gateway).
  The exchange of a token is kept by the mounted page: React's StrictMode restarts a mounted
  screen's effects once in development, which starts the machine's first invoke again, and the
  gateway signs a device in only at a link's first exchange, so the restart reuses the exchange
  already started; a page mounted anew (a later visit, a revisit after a sign-out or after a
  failed exchange) asks afresh, and another token in the address of the open page starts another
  exchange with its own machine (the part of the page that runs it is keyed by the token). `/me` (guard `authenticated`)
  renders `ProfilePage`; `/settings` (guard `authenticated`) renders `SettingsPage`: the account's
  theme (stored through `settings.updateTheme`, shown at once through the platform's
  `useDeviceTheme`, which keeps it on this device as the theme it showed last) and the account's
  language (stored through `settings.updateLocale`, spoken at once), each taken only once the
  settings are on the device and not while its store runs, a store that failed keeping the choice
  on this device and saying so on the frame's notice (`theme-not-stored`, `locale-not-stored`;
  nothing once the account left), the account's password (the current
  one, the new one typed twice and held to the rules of a new password as at sign-up, changed
  through `platform.change-password`, which signs the account's other devices out; a change says
  so on the frame's toast, `password-changed`, and the flow's `clear` empties the form, whose
  values the page holds, `useFieldClears`; a refusal shows under the field its code concerns) and
  the account's email (the new email and the current password, `platform.change-email`, which
  mails the new email a link that makes the change; the message `check-your-mail` names it, the
  same words whether that email has an account or not) and the account's deletion (the current
  password, `platform.request-account-deletion`, which mails the account's own email the link of
  the page that deletes it; the message `check-your-mail` says the account stays as it is until
  that page's button is pressed, the flow's `clear` empties the password once the mail went out,
  and a refusal (`invalid-credentials` under the field, `last-admin`, `rate-limited`, `failed`
  above the form) keeps it as typed; another press sends a fresh link), its screen's flow run as
  its machine (`application/settings/settings-machine/`: the theme, language, password, email and
  deletion regions of one parallel state, `machine.ts` assembling `password-region.ts`,
  `email-region.ts` and `deletion-region.ts`, held to `contract/domain/screens/settings.yaml` by
  `platform/machines.spec.ts`) through `useScreenMachine`, which asks the leave guard before the
  language changes; its view is `settings.view.tsx` with `password-form.view.tsx`,
  `email-form.view.tsx` and `deletion-form.view.tsx`.
- Shape `profile.shape.surql`: the signed-in identity's profile (`id`, `name`, `email`,
  `bio`, `created_at`) from `profile` in the private region.
- Commands `profile.commands.surql`: `createProfile`, `updateName`, `updateBio`.
- Shape `settings.shape.surql`: the signed-in identity's settings (`id`, `locale`, `theme`) from
  `settings` in the private region, one row per account.
- Commands `settings.commands.surql`: `createSettings` (where the account's email is first
  verified, with the language it signed up in and the theme the device shows), `updateLocale`,
  `updateTheme`. Commands run on the device through the command bus and
  replicate through the gateway like every command.
- Components: `presentation/components/page-link/` (`PageLinkProps`, `PlainLink` a view draws
  alone, `RouterLink` its container gives it) and `presentation/components/password-rule-list/`
  (`PasswordRuleList`, the rules of a new password under it, its screen giving the anchors).
- Providers: `PROFILE_SERVICE`, `SIGN_IN_SERVICE`, `VERIFY_EMAIL_SERVICE`; `SETTINGS_SERVICE`
  is provided app-wide by the composition root, since the frame reads and stores the settings too,
  and so is `ACCOUNT_START_SERVICE`, since the root finishes a start as a space opens.
- i18n namespace `user.*` (`presentation/i18n/user.en.json`, `user.es.json`).
- Anchors: screens `user.sign-in`, `user.verify-email`, `user.forgot-password`,
  `user.reset-password`, `user.confirm-email`, `user.delete-account`, `user.profile` and
  `user.settings` in `contract/domain/screens/sign-in.yaml`, `verify-email.yaml`,
  `forgot-password.yaml`, `reset-password.yaml`, `confirm-email.yaml`, `delete-account.yaml`,
  `me.yaml` and `settings.yaml`.
- Behaviour: the page runs its screen's flow as its machine (`application/profile.machine.ts`,
  held to `contract/domain/screens/me.yaml` by `platform/machines.spec.ts`) through the
  platform's `useScreenMachine`, as the sign-in page runs its own: the flow's moves pass the
  frame's guard of unsaved input, the sign-out button asks it first, and both forms are the
  kit's `Form`, whose saved submit leaves the fields with nothing unsaved; the guest pages
  (sign-in, forgot-password, verify-email) follow another tab's sign-in to the profile through
  the router's guard, a sign-in of the page's own going on to its welcome. The name and the bio
  (at most 2000 characters) each follow the stored value until typed into, then keep what was
  typed when another device stores another value, until it is saved (the name stored trimmed)
  or typed back; one Save writes what changed; a refused save is explained under the field its
  code concerns (the error's `fields`); Save and the sign-out button are enabled while the
  machine's state handles them; the chosen language, kept in the settings, follows the
  identity across devices (the frame stores and follows it, see the app-shell module), and a
  new account's settings start in the language chosen before signing up, sent with the sign-up;
  a sign-up lists the rules of a new password under the password (`user.sign-in.password-rule-list`,
  the shared `presentation/components/password-rule-list/`, each screen giving the anchors of its
  items, the lines `user.password-rule.*`), describing it, each rule
  marked `met` while the password as typed keeps it, its state read out with it
  (`user.password-rule.met` or `.not-met`), and the submit is disabled while the password
  breaks a rule, the password typed again not judged until it keeps them all;
  each password input is the kit's `PasswordInput`, whose eye (`<input>.visibility-button`,
  `user.password.show` or `.hide`) shows what it holds as typed or hides it again, presentation
  only and never an event of the flow;
  in the mode sign-in the forgot-link (`user.sign-in.forgot-link`) moves to `/forgot-password`
  carrying the email typed, as the flow's navigate says (the event carries the email field's value
  in its `fields`, the password never);
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
  and the language it signed up with and the theme that device shows; the verify page says the link is being checked
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
  (`user.sign-in.notice-message` with the code `signed-out-elsewhere`), that a change of the
  account's password signed it out, through a reset link or on another device (the code
  `password-changed-elsewhere`, when the channel closed with 4002), that a new password was set
  in another tab through a reset link (the code `password-reset-elsewhere`), and that the data
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
