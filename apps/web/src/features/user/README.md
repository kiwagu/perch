# Accounts and profile (module `user`)

## Role in the architecture

The platform's account module: signing in or creating an account, and the signed-in
identity's own profile and settings. Both live in the identity's private region: they are
read and written on the device and kept in step across devices through the gateway; the
profile is the account's face, the settings what the app is like for it (today its language),
never read by anyone else. Layers:
`domain/` holds the profile entity (schema and bounds) and one file per rule
(`profile-name.rule.ts`, `profile-bio.rule.ts`); `application/` the `SignInService` over the
session port, the `ProfileService` over the shape runner and the command bus, the
`SettingsService` the same way in its own component folder `application/settings/` (its shape
and commands beside it), the sign-in
machine (the flow of `contract/screens/sign-in.yaml`: the mode is its state, an attempt
invokes `platform.sign-in` or `platform.sign-up`, and it emits `show` and `navigate` for the
page) and one file per policy (`profile-name.policy.ts`, `profile-bio.policy.ts`,
`locale-change.policy.ts`); `presentation/` the pages, their views and the i18n catalogs.

## Surface

- Routes: `/sign-in` (guard `guest`) renders `SignInPage`; `/me` (guard `authenticated`)
  renders `ProfilePage`.
- Shape `profile.shape.surql`: the signed-in identity's profile (`id`, `name`, `email`,
  `bio`, `created_at`) from `profile` in the private region.
- Commands `profile.commands.surql`: `createProfile`, `updateName`, `updateBio`.
- Shape `settings.shape.surql`: the signed-in identity's settings (`id`, `locale`) from
  `settings` in the private region, one row per account.
- Commands `settings.commands.surql`: `createSettings` (at sign-up, with the language the app
  speaks then), `updateLocale`. Commands run on the device through the command bus and
  replicate through the gateway like every command.
- Providers: `PROFILE_SERVICE`, `SETTINGS_SERVICE`, `SIGN_IN_SERVICE`.
- i18n namespace `user.*` (`presentation/i18n/user.en.json`, `user.es.json`).
- Anchors: screens `user.sign-in` and `user.profile` in `contract/screens/sign-in.yaml` and
  `contract/screens/me.yaml`.
- Behaviour: the page runs its screen's flow as its machine (`application/profile.machine.ts`,
  held to `contract/screens/me.yaml` by `platform/machines.spec.ts`): the name and the bio
  (at most 2000 characters) each follow the stored value until typed into, then keep what was
  typed when another device stores another value, until it is saved (the name stored trimmed)
  or typed back; one Save writes what changed; a refused save is explained under the field its
  code concerns (the error's `fields`); Save and the sign-out button are enabled while the
  machine's state handles them; the chosen language, kept in the settings, follows the
  identity across devices;
  signing out asks before losing changes this device could not send, at once when the browser
  says it has no network; the sign-in page says so when the gateway refused the
  device's keys while changes remain to send after the next sign-in, and says "You were signed
  out from another device." when this device was signed out from another one
  (`user.sign-in.notice-message` with the code `signed-out-elsewhere`), and that the data
  leaves this device once the other tabs are closed when one of them held its delete up (the
  code `delete-pending`);
  it also says to wait when the gateway limits the attempts (`data:RATE_LIMITED`,
  `user.sign-in.error.rate-limited`), and to sign the other account out first while another one
  is signed in on this browser (`data:OTHER_ACCOUNT`, `user.sign-in.error.other-account`). An
  open sign-in page moves to the profile once another tab signs someone in.

## Commands

- `bun run test` in `apps/web` runs this module's specs (`*.spec.ts`, `*.view.spec.tsx`,
  `sign-in.container.spec.tsx`).
- `bun run model` regenerates `profile.model.gen.ts` and the `.surql.d.ts` files after a
  change to the `.surql` files; `bun run model:check` verifies them.
