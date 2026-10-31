import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

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

/** What a new account starts from: its identity, and the name and the language it signed up with. */
export interface AccountStart {
  readonly identity: IdentityId
  readonly name: string
  readonly locale: Locale
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
 * Makes a new account whole on the device its first verification signed in: its settings in the
 * language it signed up in, then its profile with the name it signed up with (the settings first:
 * a later commit of the region never arrives without the earlier ones). Each is created only where
 * the device holds none, under an id derived from the identity. The start is kept on this browser
 * until both exist, so one that stopped half-way (a write that failed, a page closed) is finished
 * when the account's space opens here again; the gateway signs only that device in at the first
 * verification, so no other device ever holds a start to finish.
 */
export class AccountStartService {
  constructor(
    private readonly profiles: Pick<ProfileService, 'read' | 'createProfile'>,
    private readonly settings: Pick<SettingsService, 'read' | 'createSettings'>,
    private readonly kept: KeptStartPort,
  ) {}

  /**
   * Starts `user`'s account from the name and language it signed up with: a name the profile would
   * refuse fails before anything is written or kept.
   */
  start(
    user: AuthUser,
    from: { readonly name: string; readonly locale: Locale },
  ): ResultAsync<void, SignInError> {
    const name = profileName(from.name)

    if (name.isErr()) {
      return errAsync(name.error)
    }

    const start: AccountStart = { identity: user.id, name: name.value, locale: from.locale }

    this.kept.keep(start)

    return this.#finish(user, start)
  }

  /** Finishes the start this browser kept for `user`, whose space opened here: what is missing is created. */
  resume(user: AuthUser): ResultAsync<void, SignInError> {
    const start = this.kept.kept()

    return start?.identity === user.id ? this.#finish(user, start) : okAsync(undefined)
  }

  /**
   * Forgets the kept start: this browser signed out, and the data it held went with it, so it no
   * longer knows what the account has.
   */
  forget(): void {
    this.kept.forget()
  }

  #finish(user: AuthUser, start: AccountStart): ResultAsync<void, SignInError> {
    const owner = { identity: start.identity }

    return this.settings
      .read(owner)
      .andThen((rows) =>
        rows.length > 0
          ? okAsync(undefined)
          : this.settings.createSettings({
              id: settingsIdOf(start.identity),
              identity: start.identity,
              locale: start.locale,
            }),
      )
      .andThen(() => this.profiles.read(owner))
      .andThen((rows) =>
        rows.length > 0
          ? okAsync(undefined)
          : this.profiles.createProfile({
              id: profileIdOf(start.identity),
              identity: start.identity,
              name: start.name,
              // As the account keeps it: in lower case, however it was typed.
              email: user.email,
            }),
      )
      .map(() => this.kept.forget())
  }
}

export const ACCOUNT_START_SERVICE = token<AccountStartService>('AccountStartService')
