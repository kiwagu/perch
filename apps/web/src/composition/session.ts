import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import {
  type AuthPort,
  type AuthUser,
  type Command,
  type CommandMeta,
  createAuth,
  type DataError,
  dataError,
  type LocalDb,
  type SignInInput,
  type SignUpInput,
  type WritePathPort,
} from '@workspace/data'
import { LoroWritePath, Projector, RegionDoc, type ReplicaSchema } from '@workspace/replica'

import type { SessionPort } from '../platform/session.port'

import type { KeyValueStorage } from './storage'

export interface SessionOptions {
  readonly access: string
  readonly namespace: string
  readonly database: string
  readonly schema: ReplicaSchema
  readonly storage: KeyValueStorage
  readonly onError: (error: DataError) => void
}

const TOKEN_KEY = 'perch.session.token'

/** Writes into the private region of whoever is signed in; refuses while nobody is. */
class RegionWritePath implements WritePathPort {
  #target: LoroWritePath | undefined

  attach(target: LoroWritePath | undefined): void {
    this.#target = target
  }

  run<Params>(
    command: Command<Params>,
    params: Params,
    meta?: CommandMeta,
  ): ResultAsync<void, DataError> {
    return this.#target
      ? this.#target.run(command, params, meta)
      : errAsync(dataError('data:WRITE_REJECTED', `sign in before running ${command.id}`))
  }
}

interface OpenRegion {
  readonly region: RegionDoc
  readonly projector: Projector
  readonly stop: () => void
}

/**
 * The signed-in user and their private region. Signing up, signing in or
 * restoring a saved session opens the user's region document from the local
 * database, starts projecting it and routes writes to it; signing out closes it.
 */
export class SessionService implements SessionPort {
  readonly writePath = new RegionWritePath()
  readonly #auth: AuthPort
  readonly #listeners = new Set<(user: AuthUser | undefined) => void>()
  #user: AuthUser | undefined
  #open: OpenRegion | undefined

  constructor(
    private readonly local: LocalDb,
    private readonly options: SessionOptions,
  ) {
    this.#auth = createAuth(local, options)
  }

  current(): AuthUser | undefined {
    return this.#user
  }

  region(): RegionDoc | undefined {
    return this.#open?.region
  }

  subscribe(listener: (user: AuthUser | undefined) => void): () => void {
    this.#listeners.add(listener)

    return () => this.#listeners.delete(listener)
  }

  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError> {
    return this.#auth.signUp(input).andThen((user) => this.#enter(user))
  }

  signIn(input: SignInInput): ResultAsync<AuthUser, DataError> {
    return this.#auth.signIn(input).andThen((user) => this.#enter(user))
  }

  signOut(): ResultAsync<void, DataError> {
    this.#leave()
    this.options.storage.remove(TOKEN_KEY)

    return this.#auth.signOut().map(() => this.#emit(undefined))
  }

  /** Continues the session saved by an earlier sign-in; an unusable token means signed out. */
  restore(): ResultAsync<AuthUser | undefined, DataError> {
    const saved = this.options.storage.get(TOKEN_KEY)

    if (!saved) {
      return okAsync(undefined)
    }

    return this.#auth
      .resume(saved)
      .orElse(() => okAsync(undefined))
      .andThen((user) => {
        if (!user) {
          this.options.storage.remove(TOKEN_KEY)

          return okAsync(undefined)
        }

        return this.#enter(user)
      })
  }

  /** Resolves once every local write so far is durable and projected. */
  async flush(): Promise<void> {
    await this.#open?.region.flush()
    await this.#open?.projector.flush()
  }

  #enter(user: AuthUser): ResultAsync<AuthUser, DataError> {
    this.#leave()

    return RegionDoc.open(
      this.local,
      { kind: 'private', id: `user:${user.id}` },
      { onError: this.options.onError },
    ).map((region) => {
      const projector = new Projector(region, this.local, this.options.schema, {
        onError: this.options.onError,
      })

      this.#open = { region, projector, stop: projector.start() }
      this.writePath.attach(new LoroWritePath(region, this.options.schema))

      const saved = this.#auth.token()

      if (saved) {
        this.options.storage.set(TOKEN_KEY, saved)
      }

      this.#emit(user)

      return user
    })
  }

  #leave(): void {
    this.writePath.attach(undefined)
    this.#open?.stop()
    this.#open?.region.close()
    this.#open = undefined
  }

  #emit(user: AuthUser | undefined): void {
    this.#user = user

    for (const listener of this.#listeners) {
      listener(user)
    }
  }
}
