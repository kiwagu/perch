import type { Result, ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { Command, DataError, Shape, ShapeRunnerPort } from '@workspace/data'
import { token } from '@workspace/di'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'
import type { IdentityId, ProfileId } from '@workspace/ids'

import type { CommandsPort } from '../../../platform/commands.port'
import { checkProfileBio, checkProfileName } from '../domain/profile.entity'

/** One row of the profile page: what the page shows and edits. */
export interface ProfileRow {
  readonly id: ProfileId
  readonly name: string
  readonly email: string
  readonly bio?: string | undefined
  readonly locale?: string | undefined
  readonly created_at: Date
}

export interface ProfileOwner {
  readonly identity: IdentityId
}

export interface NewProfile {
  readonly id: ProfileId
  readonly identity: IdentityId
  readonly name: string
  readonly email: string
}

/** The reads and writes the service needs; the module passes the ones the modeling stage generated. */
export interface ProfileModel {
  readonly shape: Shape<ProfileOwner, readonly ProfileRow[]>
  readonly commands: {
    readonly createProfile: Command<NewProfile>
    readonly updateName: Command<{ readonly id: ProfileId; readonly name: string }>
    readonly updateBio: Command<{ readonly id: ProfileId; readonly bio: string }>
    readonly updateLocale: Command<{ readonly id: ProfileId; readonly locale: Locale }>
  }
}

/** The display name as the domain accepts it, or the rule it breaks. */
export function profileName(name: string): Result<string, BusError> {
  return checkProfileName(name).mapErr((violations) => ({
    code: violations[0]?.code ?? 'profile:INVALID_NAME',
    causes: violations,
  }))
}

/** A bio as the domain accepts it, or the rule it breaks. */
export function profileBio(bio: string): Result<string, BusError> {
  return checkProfileBio(bio).mapErr((violations) => ({
    code: violations[0]?.code ?? 'profile:INVALID_BIO',
    causes: violations,
  }))
}

/**
 * How the application language and the one stored in the profile meet: the
 * stored one wins when the profile first arrives on this device, and after that
 * the user's choice is stored.
 */
export function localeChange(input: {
  readonly stored: string | undefined
  readonly current: Locale
  readonly first: boolean
}): { readonly apply: Locale } | { readonly save: Locale } | undefined {
  const stored = SUPPORTED_LOCALES.find((locale) => locale === input.stored)

  if (input.first && stored) {
    return stored === input.current ? undefined : { apply: stored }
  }

  return stored === input.current ? undefined : { save: input.current }
}

/** Reads and edits the profile of the signed-in user. */
export class ProfileService {
  constructor(
    private readonly runner: ShapeRunnerPort,
    private readonly commands: CommandsPort,
    private readonly model: ProfileModel,
  ) {}

  read(owner: ProfileOwner): ResultAsync<readonly ProfileRow[], DataError> {
    return this.runner.read(this.model.shape, owner)
  }

  watch(owner: ProfileOwner, onTree: (tree: readonly ProfileRow[]) => void): () => void {
    return this.runner.watch(this.model.shape, owner, onTree)
  }

  createProfile(profile: NewProfile): ResultAsync<void, BusError> {
    return profileName(profile.name).asyncAndThen((name) =>
      this.commands.execute(this.model.commands.createProfile, { ...profile, name }),
    )
  }

  updateName(input: {
    readonly id: ProfileId
    readonly name: string
  }): ResultAsync<void, BusError> {
    return profileName(input.name).asyncAndThen((name) =>
      this.commands.execute(this.model.commands.updateName, { id: input.id, name }),
    )
  }

  updateBio(input: { readonly id: ProfileId; readonly bio: string }): ResultAsync<void, BusError> {
    return profileBio(input.bio).asyncAndThen((bio) =>
      this.commands.execute(this.model.commands.updateBio, { id: input.id, bio }),
    )
  }

  updateLocale(input: {
    readonly id: ProfileId
    readonly locale: Locale
  }): ResultAsync<void, BusError> {
    return this.commands.execute(this.model.commands.updateLocale, input)
  }
}

export const PROFILE_SERVICE = token<ProfileService>('ProfileService')
