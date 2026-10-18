# Accounts and profile (module `user`)

## Role in the architecture

The platform's account module: signing in or creating an account, and the signed-in
identity's own profile. The profile lives in the identity's private region: it is read and
written on the device and kept in step across devices through the gateway. Layers:
`domain/` holds the profile entity and its rules, `application/` the `SignInService` over
the session port, the `ProfileService` over the shape runner and the command bus, and the
sign-in state machine; `presentation/` the pages, their views and the i18n catalogs.

## Surface

- Routes: `/sign-in` (guard `guest`) renders `SignInPage`; `/me` (guard `authenticated`)
  renders `ProfilePage`.
- Shape `profile.shape.surql`: the signed-in identity's profile (`id`, `name`, `email`,
  `bio`, `locale`, `created_at`) from `profile` in the private region.
- Commands `profile.commands.surql`: `createProfile`, `updateName`, `updateBio`,
  `updateLocale`. They run on the device through the command bus and replicate through the
  gateway like every command.
- Providers: `PROFILE_SERVICE`, `SIGN_IN_SERVICE`.
- i18n namespace `user.*` (`presentation/i18n/user.en.json`, `user.es.json`); test ids
  `user.sign-in.*` and `user.profile.*`.
- Behaviour: the name and the bio (at most 2000 characters) are saved together by one Save;
  the chosen language follows the identity across devices; signing out asks before losing
  changes this device could not send; the sign-in page says so when the gateway refused the
  device's keys while changes remain to send after the next sign-in, and says "You were signed
  out from another device." when this device was signed out from another one
  (`user.sign-in.notice.signed-out-elsewhere`).

## Commands

- `bun run test` in `apps/web` runs this module's specs (`*.spec.ts`, `*.view.spec.tsx`).
- `bun run model` regenerates `profile.model.gen.ts` and the `.surql.d.ts` files after a
  change to the `.surql` files; `bun run model:check` verifies them.
