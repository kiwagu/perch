/**
 * The seed client's accounts: one signed in, or signed up and verified through the mail in the
 * stand's mailbox, then its profile and settings written as the catalog describes them; and an
 * account read back as another device sees it.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError, type SignInInput } from '@workspace/data'
import { type ProfileId, profileIdFactory, settingsIdFactory } from '@workspace/ids'

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

/** The account's profile as the catalog describes it: created when missing, its bio set. */
const ensureProfile = (
  device: SeedDevice,
  user: AuthUser,
  input: AccountInput,
): ResultAsync<ProfileId, SeedError> =>
  profileOf(device, user)
    .andThen((row): ResultAsync<Pick<ProfileRow, 'id' | 'bio'>, SeedError> => {
      if (row) {
        return okAsync(row)
      }

      const id = profileIdFactory.create()

      return device.profiles
        .createProfile({ id, identity: user.id, name: input.name, email: user.email })
        .map(() => ({ id, bio: undefined }))
    })
    .andThen((profile) =>
      (profile.bio === input.bio
        ? okAsync(undefined)
        : device.profiles.updateBio({ id: profile.id, bio: input.bio })
      ).map(() => profile.id),
    )

/**
 * The account's settings as the catalog describes them: created when missing, its language set,
 * its theme the device's own setting, as for an account a device that shows no theme of its own
 * starts.
 */
const ensureSettings = (
  device: SeedDevice,
  user: AuthUser,
  input: AccountInput,
): ResultAsync<void, SeedError> =>
  device.settings.read({ identity: user.id }).andThen(([row]): ResultAsync<void, SeedError> => {
    if (!row) {
      return device.settings.createSettings({
        id: settingsIdFactory.create(),
        identity: user.id,
        locale: input.locale,
        theme: 'system',
      })
    }

    return row.locale === input.locale
      ? okAsync(undefined)
      : device.settings.updateLocale({ id: row.id, locale: input.locale })
  })

/**
 * Signs in, or signs up and verifies the account through its mail (`signedInOrVerified`), then
 * writes its settings and its profile as the catalog describes them, the settings first as the
 * first verification writes them, and waits until the gateway acknowledged everything.
 */
export function ensureAccount(
  device: SeedDevice,
  input: AccountInput,
): ResultAsync<SeededAccount, SeedError> {
  return device
    .enter(() => signedInOrVerified(device, input))
    .andThen((user) =>
      ensureSettings(device, user, input).andThen(() =>
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
