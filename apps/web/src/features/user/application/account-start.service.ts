import { errAsync, okAsync, type Result, type ResultAsync } from 'neverthrow'

import type { AuthUser } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'
import {
  type IdentityId,
  type ProfileId,
  profileIdFactory,
  type SettingsId,
  settingsIdFactory,
} from '@workspace/ids'

import type { ProfileService } from './profile.service'
import { profileName } from './profile-name.policy'
import type { SettingsService } from './settings/settings.service'
import type { SignInError } from './sign-in.service'

/** The name and the language an account signed up with, which its profile and settings start from. */
export interface AccountStartFrom {
  readonly name: string
  readonly locale: Locale
}

/**
 * What a new account starts from: its identity, and the name and the language it signed up with;
 * `afterPull` while the device must first pull what the account already has (a start a sign-in
 * learnt of: another device may have started the account meanwhile).
 */
export interface AccountStart extends AccountStartFrom {
  readonly identity: IdentityId
  readonly afterPull: boolean
}

/**
 * Where this browser keeps the start of an account until its settings and its profile both exist:
 * one at a time, as one account is signed in on a browser.
 */
export interface KeptStartPort {
  keep(start: AccountStart): void
  kept(): AccountStart | undefined
  forget(): void
}

/**
 * Resolves once what this tab's documents hold, what they pulled from the gateway included, is
 * projected in the local store the reads see.
 */
export type Projected = () => ResultAsync<void, SignInError>

/**
 * Runs `run` as the only account start among this browser's tabs, once the tab before it left what
 * it wrote durable and projected in the local store the tabs share and this tab's own documents are
 * projected there, so `run` reads all of it; `run` is handed `projected` to await the projection
 * again within its turn. It leaves its own writes durable and projected for the next.
 */
export type StartTurns = <T>(
  run: (projected: Projected) => ResultAsync<T, SignInError>,
) => ResultAsync<T, SignInError>

/**
 * A record of the account, created when the store holds none. A create the document refuses because
 * the record is there after all (another device's, which reached this document after the read) is
 * done once its projection shows it; any other failure stays the start's.
 */
function ensured(
  read: () => ResultAsync<readonly unknown[], SignInError>,
  create: () => ResultAsync<void, SignInError>,
  projected: Projected,
): ResultAsync<void, SignInError> {
  return read().andThen((rows) =>
    rows.length > 0
      ? okAsync(undefined)
      : create().orElse((refused) =>
          projected()
            .andThen(read)
            .andThen((now) => (now.length > 0 ? okAsync(undefined) : errAsync(refused))),
        ),
  )
}

/** What an id keeps after its prefix. */
const bodyOf = (identity: IdentityId): string => identity.slice(identity.indexOf('_') + 1)

/**
 * The ids of the account's own settings and profile: the identity's id under each record's
 * prefix, the same on every device and in every tab, so the account never gets a second one. The
 * body of a valid id is valid under any prefix of the registry.
 */
const settingsIdOf = (identity: IdentityId): SettingsId =>
  settingsIdFactory.brand(`${settingsIdFactory.prefix}_${bodyOf(identity)}`)

const profileIdOf = (identity: IdentityId): ProfileId =>
  profileIdFactory.brand(`${profileIdFactory.prefix}_${bodyOf(identity)}`)

/**
 * Makes a new account whole on the device that enters it first: its settings in the language it
 * signed up in, then its profile with the name it signed up with (the settings first: a later
 * commit of the region never arrives without the earlier ones). Each is created only where the
 * device holds none, under an id derived from the identity. The device its first verification
 * signed in starts it at once: the gateway signs only that device in at the first verification,
 * so nothing of the account exists elsewhere. A device whose sign-in answered that the account has
 * not started (a reset verified its email, or the device that verified it has not synced its start
 * yet) keeps the start until it has pulled what the account has, then creates what is still
 * missing. The start is kept on this browser until both exist, so one that stopped half-way (a
 * write that failed, a page closed) is finished when the account's space opens here again, or
 * after the pull for one that waits for it. The browser's tabs take turns
 * (`StartTurns`): each reads the kept start and the account's records afresh in its turn, so a tab
 * never creates a record another tab created, whose later edits a second record under the same
 * key could hide.
 */
export class AccountStartService {
  constructor(
    private readonly profiles: Pick<ProfileService, 'read' | 'createProfile'>,
    private readonly settings: Pick<SettingsService, 'read' | 'createSettings'>,
    private readonly kept: KeptStartPort,
    private readonly turns: StartTurns,
  ) {}

  /**
   * Starts `user`'s account from the name and language it signed up with: a name the profile would
   * refuse fails before anything is written or kept.
   */
  start(user: AuthUser, from: AccountStartFrom): ResultAsync<void, SignInError> {
    const kept = this.#keep(user, from, false)

    return kept.isErr()
      ? errAsync(kept.error)
      : this.turns((projected) => this.#finish(user, kept.value, projected))
  }

  /**
   * Keeps the start a sign-in of `user` learnt of, the account having no settings or profile at the
   * gateway yet, to finish once this device has pulled what the account has (`resumeAfterPull`):
   * another device may have started it meanwhile, and a record created before the pull would race
   * the one at the same key. A name the profile would refuse keeps nothing.
   */
  keepAfterPull(user: AuthUser, from: AccountStartFrom): Result<void, SignInError> {
    return this.#keep(user, from, true).map(() => undefined)
  }

  /**
   * Finishes the start this browser kept for `user`, whose space opened here: what is missing is
   * created. A start another tab finished meanwhile is no longer kept, and nothing is created; nor
   * is one that waits for this device's first pull.
   */
  resume(user: AuthUser): ResultAsync<void, SignInError> {
    return this.turns((projected) => {
      const start = this.kept.kept()

      return start?.identity === user.id && !start.afterPull
        ? this.#finish(user, start, projected)
        : okAsync(undefined)
    })
  }

  /**
   * Finishes the start this browser kept for `user` once this device has pulled what the account
   * has: only what the pull left missing is created.
   */
  resumeAfterPull(user: AuthUser): ResultAsync<void, SignInError> {
    return this.turns((projected) => {
      const start = this.kept.kept()

      return start?.identity === user.id ? this.#finish(user, start, projected) : okAsync(undefined)
    })
  }

  /** Keeps the start of `user`, its name checked first. */
  #keep(
    user: AuthUser,
    from: AccountStartFrom,
    afterPull: boolean,
  ): Result<AccountStart, SignInError> {
    return profileName(from.name).map((name) => {
      const start: AccountStart = { identity: user.id, name, locale: from.locale, afterPull }

      this.kept.keep(start)

      return start
    })
  }

  #finish(
    user: AuthUser,
    start: AccountStart,
    projected: Projected,
  ): ResultAsync<void, SignInError> {
    const owner = { identity: start.identity }

    return ensured(
      () => this.settings.read(owner),
      () =>
        this.settings.createSettings({
          id: settingsIdOf(start.identity),
          identity: start.identity,
          locale: start.locale,
        }),
      projected,
    )
      .andThen(() =>
        ensured(
          () => this.profiles.read(owner),
          () =>
            this.profiles.createProfile({
              id: profileIdOf(start.identity),
              identity: start.identity,
              name: start.name,
              // As the account keeps it: in lower case, however it was typed.
              email: user.email,
            }),
          projected,
        ),
      )
      .map(() => this.kept.forget())
  }
}

export const ACCOUNT_START_SERVICE = token<AccountStartService>('AccountStartService')
