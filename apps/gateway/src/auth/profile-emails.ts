import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { privateRegionId } from '@workspace/replica'
import type { RegionHub } from '@workspace/replica/server'
import { z } from '@workspace/zod'

import type { KeyedTurns } from '../keyed-turns'

import type { AuthLog } from './auth-log'
import { reading } from './device-session-rows'
import profileEmailStatement from './surql/profile-email.surql'

/** What the directory holds of an identity for its profile's email. */
const profileEmailRow = z.object({
  email: z.string(),
  profile: idSchemas.profile.schema.nullish(),
  profile_email: z.string().nullish(),
})

/** An identity's email, and its profile's key and email when it has a profile. */
type ProfileEmailRow = z.infer<typeof profileEmailRow>

/** What one attempt did: wrote the email, found no profile to write it on, or failed. */
type Attempt = 'written' | 'no-profile'

export interface ProfileEmailsOptions {
  /** The directory: the identity's email, and its profile as the region hub projected it. */
  readonly directory: LocalDb
  /** The region hub, which writes the email into the identity's private region. */
  readonly hub: Pick<RegionHub, 'writeRecord'>
  /** Hears an email that did not reach the profile, by its code; the request was answered already. */
  readonly log: AuthLog
  /**
   * One account's work, one turn at a time (the auth mount's turns): a write of the profile's
   * email runs in the account's turn, after the work asked of the account before it and before
   * the work asked after it.
   */
  readonly turns: KeyedTurns<string>
}

/**
 * Keeps an account's profile carrying its email: the email lives on the identity, which signs in
 * with it, while every device shows the `email` of the profile in the identity's private region,
 * which the devices only create. `follow` writes the identity's email as it is then into the
 * profile, through the region hub (`writeRecord`, a change of the server's own, logged, projected
 * and sent to every subscribed device like a device's batch; a device that was offline gets it at
 * its next pull). The profile is found by its identity in the directory, where the hub projects
 * the region's rows, so a profile under any id is found. A write that changes nothing logs
 * nothing, so following twice is harmless, and the email as it is when the write runs is the one
 * written, so an earlier follow running late never puts an older email back.
 *
 * A confirmation of a new email asks for the follow at once (`queue`), in the account's turn. That
 * follow lives in this process only: a gateway that stops between the email's move and the write
 * loses it. So every hello of a device of the account also compares the two (`reconcile`) and
 * queues a follow when the profile's email is not the identity's: after a restart every device
 * says hello again, and the first one brings the profile in step, with no other confirmation. It
 * also brings in step, at the next hello of any device, a profile a device created with an email
 * the account no longer has.
 */
export class ProfileEmails {
  readonly #options: ProfileEmailsOptions

  constructor(options: ProfileEmailsOptions) {
    this.#options = options
  }

  /**
   * Asks for a follow of `identity`'s profile in the account's next turn, after the work asked of
   * the account before it, and returns at once: whoever asks waits for nothing the profile decides.
   */
  queue(identity: IdentityId): void {
    void this.#options.turns.run(identity, () => this.follow(identity))
  }

  /**
   * Compares `identity`'s email with its profile's, as the directory holds them, and queues a
   * follow (`queue`) when the profile carries another; nothing when they agree or the account has
   * no profile yet. Returns at once; a read that fails is logged by its code.
   */
  reconcile(identity: IdentityId): void {
    void this.#read(identity).match(
      ({ email, profile, profile_email }) => {
        if (profile !== undefined && profile !== null && profile_email !== email) {
          this.queue(identity)
        }
      },
      (error) =>
        this.#options.log.error(
          { code: error.code },
          'the email of an account could not be compared with its profile',
        ),
    )
  }

  /**
   * Writes `identity`'s current email into its profile, the caller holding the account's turn.
   * An account with no profile in the directory yet (no device's start reached the server) gets
   * nothing written: the device that starts it later creates the profile with the account's email
   * as it is then. A failure is tried once more, then logged by its code; a profile the hub refuses
   * to write is logged at once. Never rejects: the email changed already, whatever happens here.
   */
  async follow(identity: IdentityId): Promise<void> {
    const { log } = this.#options
    const first = await this.#attempt(identity)
    const outcome =
      first.isErr() && first.error.code !== 'data:WRITE_REJECTED'
        ? await this.#attempt(identity)
        : first

    outcome.match(
      (done) => {
        if (done === 'no-profile') {
          log.warn(
            { code: 'auth:PROFILE_NOT_STARTED' },
            'the account has no profile to carry its new email yet',
          )
        }
      },
      (error) =>
        log.error({ code: error.code }, 'the new email of an account did not reach its profile'),
    )
  }

  /** The identity's email, and its profile's key and email, as the directory holds them. */
  #read(identity: IdentityId): ResultAsync<ProfileEmailRow, DataError> {
    return reading(
      this.#options.directory.db.query<[unknown]>(profileEmailStatement, { identity }),
      `the profile of ${identity} could not be read`,
    ).andThen(([value]) => {
      const row = profileEmailRow.safeParse(value)

      return row.success
        ? okAsync(row.data)
        : errAsync(dataError('data:QUERY_FAILED', 'the profile of an account has an unknown shape'))
    })
  }

  /** Reads the identity's email and profile, then writes the one into the other. */
  #attempt(identity: IdentityId): ResultAsync<Attempt, DataError> {
    return this.#read(identity).andThen(({ email, profile }) =>
      profile === undefined || profile === null
        ? okAsync<Attempt, DataError>('no-profile')
        : this.#options.hub
            .writeRecord(
              { kind: 'private', id: privateRegionId(identity) },
              { table: 'profile', id: profile, set: { email } },
            )
            .map((): Attempt => 'written'),
    )
  }
}
