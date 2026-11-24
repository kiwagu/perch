import { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import type { AuthLog } from '../auth/auth-log'
import type { StartingLanguage } from '../auth/starting-language.port'

import { answered } from './invitations'
import { reading } from './organisation-rows'
import invitationsToEmailStatement from './surql/invitations-to-email.surql'
import organisationLocaleStatement from './surql/organisation-locale.surql'
import type { TenantDatabases } from './tenant-databases'

/** How long the gateway looks for the starting language of a sign-up before it starts without it. */
export const STARTING_LANGUAGE_BUDGET_MS = 250

export interface InvitedLanguageDeps {
  /** The directory, which holds the invitations. */
  readonly directory: LocalDb
  /** The organisations' databases, which hold each organisation's settings row. */
  readonly databases: Pick<TenantDatabases, 'acquire'>
  readonly clock: Clock
  readonly log: Pick<AuthLog, 'warn'>
  /** How long the whole lookup may take before the account starts in its sign-up page's language. */
  readonly budgetMs: number
}

const invitedBy = z.array(z.object({ key: z.string() }))
const localeOf = z.string().nullish()

/** What the lookup found: a language, none, or a failure to read, by the organisation. */
type Found = Locale | undefined

/**
 * The language an account an invitation creates starts in: the email's pending invitations (not
 * expired, to ready organisations), newest first, then each organisation's own settings row
 * (`ost_<key>`) in that order; the first that names a language wins. A read that fails names none
 * (`sign-up:STARTING_LANGUAGE_UNREADABLE`, by the organisation's key), and so does a lookup that
 * outlasts `budgetMs` on the gateway's clock (`sign-up:STARTING_LANGUAGE_LATE`), whose reads still
 * let each organisation's database go once they settle. Nothing here is thrown or names the email.
 */
export class InvitedLanguage implements StartingLanguage {
  readonly #deps: InvitedLanguageDeps

  constructor(deps: InvitedLanguageDeps) {
    this.#deps = deps
  }

  async of(email: string): Promise<Locale | undefined> {
    let late = false
    let cancel = () => {}
    const budget = new Promise<'late'>((resolve) => {
      cancel = this.#deps.clock.schedule(this.#deps.budgetMs, () => resolve('late'))
    })
    const found = await Promise.race([this.#lookup(email.toLowerCase(), () => late), budget])

    cancel()

    if (found === 'late') {
      late = true
      this.#deps.log.warn(
        { code: 'sign-up:STARTING_LANGUAGE_LATE' },
        'the starting language of an invited account was not read in time',
      )

      return undefined
    }

    return found
  }

  /** The language the lookup finds; it stops before another read once `late` holds. */
  async #lookup(email: string, late: () => boolean): Promise<Found> {
    const invited = await reading(
      this.#deps.directory.db.query(invitationsToEmailStatement, {
        email,
        now: new Date(this.#deps.clock.now()),
      }),
      'the invitations of an email could not be read',
    ).andThen((answer) => answered(invitedBy, answer, 'the answer to the invitations of an email'))

    if (invited.isErr()) {
      this.#unreadable('the invitations of an email could not be read')

      return undefined
    }

    for (const { key } of invited.value) {
      if (late()) {
        return undefined
      }

      const locale = await this.#localeOf(key)

      if (locale.isErr()) {
        this.#unreadable(`the default language of the organisation ${key} could not be read`)

        return undefined
      }

      if (locale.value !== undefined) {
        return locale.value
      }
    }

    return undefined
  }

  /** The default language of the organisation `key`'s own settings row; none when it names none. */
  #localeOf(key: string): ResultAsync<Found, DataError> {
    return this.#deps.databases.acquire(key).andThen((handle) => {
      const read = async () => {
        try {
          return await reading(
            handle.local.db.query(organisationLocaleStatement, { id: `ost_${key}` }),
            `the default language of ${key} could not be read`,
          ).andThen((answer) =>
            answered(localeOf, answer, `the answer to the default language of ${key}`),
          )
        } finally {
          handle.release()
        }
      }

      return new ResultAsync(read()).map((locale) =>
        SUPPORTED_LOCALES.find((supported) => supported === locale),
      )
    })
  }

  #unreadable(message: string): void {
    this.#deps.log.warn({ code: 'sign-up:STARTING_LANGUAGE_UNREADABLE' }, message)
  }
}
