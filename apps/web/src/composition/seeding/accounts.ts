/**
 * The seed client's accounts: one signed in, or signed up and verified through the mail in the
 * stand's mailbox, then its profile and settings written as the catalog describes them; and an
 * account read back as another device sees it.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError, type SignInInput } from '@workspace/data'
import type { ProfileId } from '@workspace/ids'

import type { ProfileRow } from '../../features/user/application/profile.service'

import type { AccountInput, AccountView, SeedDevice, SeedError, SeededAccount } from './types'

/** The mailbox could not tell how many mails reached the account: nothing of the email is kept. */
const unreadMailbox = () => dataError('data:AUTH_FAILED', 'the mailbox could not be read')

/** No verification mail came: nothing of the email or of what the mailbox said is kept. */
const noMail = () => dataError('data:AUTH_FAILED', 'no verification mail reached the mailbox')

/** How many mails reached `email` before the one the next step makes the gateway send. */
const mailsSoFar = (device: SeedDevice, email: string): ResultAsync<number, DataError> =>
  ResultAsync.fromPromise(device.inbox.count(email), unreadMailbox)

/**
 * Opens the verification link of the mail to `credentials.email` after its first `seen`: the
 * first opening signs the device in; a link opened before signs nothing in, and the account
 * signs in with its password.
 */
function verified(
  device: SeedDevice,
  credentials: SignInInput,
  seen: number,
): ResultAsync<AuthUser, DataError> {
  return ResultAsync.fromPromise(device.inbox.verificationToken(credentials.email, seen), noMail)
    .andThen((token) => device.session.verifyEmail(token))
    .andThen((outcome) =>
      outcome.kind === 'signed-in' ? okAsync(outcome.user) : device.session.signIn(credentials),
    )
}

/**
 * Signs the account in. One not verified yet whose password is right has its mail sent again,
 * whose link signs it in. An email without an account with this password is signed up, then
 * signed in again: refused as not verified, the account was just made and its mail is read;
 * refused as invalid credentials, the email has an account with another password, which a
 * sign-up answers alike and sends nothing to, so that refusal is the answer and no mail is
 * waited for. Every mail is counted before the step that sends it, so the one read is its own.
 */
function signedInOrVerified(
  device: SeedDevice,
  input: AccountInput,
): ResultAsync<AuthUser, DataError> {
  const credentials = { email: input.email, password: input.password }

  return device.session.signIn(credentials).orElse((refused) => {
    if (refused.code === 'data:EMAIL_NOT_VERIFIED') {
      return mailsSoFar(device, input.email).andThen((seen) =>
        device.session
          .resendVerification(input.email)
          .andThen(() => verified(device, credentials, seen)),
      )
    }

    if (refused.code !== 'data:INVALID_CREDENTIALS') {
      return errAsync(refused)
    }

    return mailsSoFar(device, input.email).andThen((seen) =>
      device.session
        .signUp({
          email: input.email,
          password: input.password,
          name: input.name,
          locale: input.locale,
        })
        .andThen(() => device.session.signIn(credentials))
        .orElse((again) =>
          again.code === 'data:EMAIL_NOT_VERIFIED'
            ? verified(device, credentials, seen)
            : errAsync(again),
        ),
    )
  })
}

const profileOf = (
  device: SeedDevice,
  user: AuthUser,
): ResultAsync<ProfileRow | undefined, SeedError> =>
  device.profiles.read({ identity: user.id }).map(([row]) => row)

/** A record the start made sure of is missing: the start did not make the account whole. */
const notStarted = (record: string) =>
  dataError('data:WRITE_FAILED', `the account has no ${record} after its start`)

/**
 * Starts the account the way the app does, now that the device has pulled what it has: the start
 * a sign-in or the first verification kept is finished, or one is kept from the catalog's name and
 * language and finished, creating only what is missing, under the ids derived from the identity.
 * The app's own start, which finishes the same start beside it, then finds both records.
 */
const started = (
  device: SeedDevice,
  user: AuthUser,
  input: AccountInput,
): ResultAsync<void, SeedError> =>
  device.starts
    .keepAfterPull(user, { name: input.name, locale: input.locale })
    .asyncAndThen(() => device.starts.resumeAfterPull(user))

/** The account's profile as the catalog describes it: its bio set. */
const ensureProfile = (
  device: SeedDevice,
  user: AuthUser,
  input: AccountInput,
): ResultAsync<ProfileId, SeedError> =>
  profileOf(device, user).andThen((profile) =>
    profile
      ? (profile.bio === input.bio
          ? okAsync(undefined)
          : device.profiles.updateBio({ id: profile.id, bio: input.bio })
        ).map(() => profile.id)
      : errAsync(notStarted('profile')),
  )

/** The account's settings as the catalog describes them: its language set. */
const ensureSettings = (
  device: SeedDevice,
  user: AuthUser,
  input: AccountInput,
): ResultAsync<void, SeedError> =>
  device.settings.read({ identity: user.id }).andThen(([row]): ResultAsync<void, SeedError> => {
    if (!row) {
      return errAsync(notStarted('settings'))
    }

    return row.locale === input.locale
      ? okAsync(undefined)
      : device.settings.updateLocale({ id: row.id, locale: input.locale })
  })

/**
 * Signs in, or signs up and verifies the account through its mail (`signedInOrVerified`), starts
 * it as the app does (`started`: its settings in the catalog's language and the device's own
 * theme, then its profile), sets its settings and its profile as the catalog describes them, and
 * waits until the gateway acknowledged everything.
 */
export function ensureAccount(
  device: SeedDevice,
  input: AccountInput,
): ResultAsync<SeededAccount, SeedError> {
  return device
    .enter(() => signedInOrVerified(device, input))
    .andThen((user) =>
      started(device, user, input)
        .andThen(() => ensureSettings(device, user, input))
        .andThen(() =>
          ensureProfile(device, user, input).map((profileId) => ({ user, profileId })),
        ),
    )
    .andThen((seeded) => device.settle().map(() => seeded))
}

/** Signs in and reads the account's profile and settings once the gateway's copy arrived. */
export function readAccount(
  device: SeedDevice,
  input: SignInInput,
): ResultAsync<AccountView, SeedError> {
  return device
    .enter(() => device.session.signIn(input))
    .andThen((user) =>
      profileOf(device, user).andThen((profile) =>
        device.settings
          .read({ identity: user.id })
          .map(([row]) => ({ user, profile, settings: row })),
      ),
    )
}
