import { errAsync, okAsync, ResultAsync } from 'neverthrow'

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

const REFRESH_KEY = 'perch.session.refresh'

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
    // Every new pair is kept, renewals included: a refresh key works once, so the
    // next reload needs the latest one. A session the driver ends on its own keeps
    // the stored keys, since the refresh key still resumes it.
    this.#auth.onTokens((tokens) => {
      if (!tokens) {
        return
      }

      options.storage.set(TOKEN_KEY, tokens.access)

      if (tokens.refresh) {
        options.storage.set(REFRESH_KEY, tokens.refresh)
      } else {
        options.storage.remove(REFRESH_KEY)
      }
    })
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
    this.#forget()

    return this.#auth.signOut().map(() => this.#emit(undefined))
  }

  /** Continues the session saved by an earlier sign-in; an unusable token means signed out. */
  restore(): ResultAsync<AuthUser | undefined, DataError> {
    const access = this.options.storage.get(TOKEN_KEY)

    if (!access) {
      return okAsync(undefined)
    }

    return this.#auth
      .resume({ access, refresh: this.options.storage.get(REFRESH_KEY) })
      .orElse(() => okAsync(undefined))
      .andThen((user) => {
        if (!user) {
          this.#forget()

          return okAsync(undefined)
        }

        return this.#enter(user)
      })
  }

  /** Resolves once every local write so far is durable and projected; reports one that is not durable. */
  flush(): ResultAsync<void, DataError> {
    const open = this.#open

    if (!open) {
      return okAsync(undefined)
    }

    return open.region.flush().andThen(() => ResultAsync.fromSafePromise(open.projector.flush()))
  }

  #enter(user: AuthUser): ResultAsync<AuthUser, DataError> {
    this.#leave()

    return RegionDoc.open(this.local, { kind: 'private', id: `user:${user.id}` }).map((region) => {
      const projector = new Projector(region, this.local, this.options.schema, {
        onError: this.options.onError,
      })

      this.#open = { region, projector, stop: projector.start() }
      this.writePath.attach(new LoroWritePath(region, this.options.schema))
      this.#emit(user)

      return user
    })
  }

  #forget(): void {
    this.options.storage.remove(TOKEN_KEY)
    this.options.storage.remove(REFRESH_KEY)
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
