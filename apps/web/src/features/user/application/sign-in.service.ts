import { errAsync, type ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { AuthUser, DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'
import { profileIdFactory, settingsIdFactory } from '@workspace/ids'

import type { SessionPort } from '../../../platform/session.port'

import type { ProfileService } from './profile.service'
import { profileName } from './profile-name.policy'
import type { SettingsService } from './settings/settings.service'

export type SignInMode = 'sign-in' | 'sign-up'

/** What the form collects, and the language the app speaks as it is sent; signing in ignores the name and the language. */
export interface SignInForm {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly locale: Locale
}

export type SignInError = DataError | BusError

/** Signs into an account, or creates one together with its profile and its settings. */
export class SignInService {
  constructor(
    private readonly session: Pick<SessionPort, 'signIn' | 'signUp'>,
    private readonly profiles: Pick<ProfileService, 'createProfile'>,
    private readonly settings: Pick<SettingsService, 'createSettings'>,
  ) {}

  submit(mode: SignInMode, form: SignInForm): ResultAsync<AuthUser, SignInError> {
    return mode === 'sign-up' ? this.signUp(form) : this.signIn(form)
  }

  signIn(form: SignInForm): ResultAsync<AuthUser, SignInError> {
    return this.session.signIn({ email: form.email, password: form.password })
  }

  signUp(form: SignInForm): ResultAsync<AuthUser, SignInError> {
    const name = profileName(form.name)

    if (name.isErr()) {
      return errAsync(name.error)
    }

    // The account holds only what signing in needs; the name lives in the profile, and the
    // settings start from what the app is like as the form is sent.
    return this.session.signUp({ email: form.email, password: form.password }).andThen((user) =>
      this.profiles
        .createProfile({
          id: profileIdFactory.create(),
          identity: user.id,
          name: name.value,
          // As the account keeps it: in lower case, however it was typed.
          email: user.email,
        })
        .andThen(() =>
          this.settings.createSettings({
            id: settingsIdFactory.create(),
            identity: user.id,
            locale: form.locale,
          }),
        )
        .map(() => user),
    )
  }
}

export const SIGN_IN_SERVICE = token<SignInService>('SignInService')
