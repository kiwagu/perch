import type {
  BaseAccount,
  BaseSession,
  BaseUser,
  BaseVerification,
  BetterAuthDBOptions,
} from 'better-auth'

import {
  accountIdFactory,
  device_sessionIdFactory,
  identityIdFactory,
  verificationIdFactory,
} from '@workspace/ids'

/** Where one of Better Auth's models lives: our table and the snake_case column of each field. */
type ModelMapping<Name extends string, Model> = Required<
  Pick<BetterAuthDBOptions<Name, Extract<keyof Model, string>>, 'modelName' | 'fields'>
>

/**
 * Better Auth's four core models on the directory's tables: a user is an `identity`, a session a
 * `device_session`; every camelCase field Better Auth names is stored in its snake_case column.
 */
export const AUTH_MODELS = {
  user: {
    modelName: 'identity',
    fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
  },
  session: {
    modelName: 'device_session',
    fields: {
      userId: 'identity',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  account: {
    modelName: 'account',
    fields: {
      userId: 'identity',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      idToken: 'id_token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verification',
    fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
  },
} as const satisfies {
  readonly user: ModelMapping<'user', BaseUser>
  readonly session: ModelMapping<'session', BaseSession>
  readonly account: ModelMapping<'account', BaseAccount>
  readonly verification: ModelMapping<'verification', BaseVerification>
}

/** What mints the ids of one table. */
interface IdFactory {
  create(): string
}

/** The id factory of each model, under Better Auth's name and under our table's. */
const FACTORIES: ReadonlyMap<string, IdFactory> = new Map<string, IdFactory>([
  ['user', identityIdFactory],
  ['identity', identityIdFactory],
  ['session', device_sessionIdFactory],
  ['device_session', device_sessionIdFactory],
  ['account', accountIdFactory],
  ['verification', verificationIdFactory],
])

/**
 * Better Auth's `advanced.database.generateId`: a row gets an id of our format, with the prefix of
 * its table. A model without a kind is refused, so a plugin's new table is mapped on purpose.
 */
export function generateAuthId(options: { readonly model: string }): string {
  const factory = FACTORIES.get(options.model)

  if (factory === undefined) {
    throw new Error(`no id kind for model ${options.model}`)
  }

  return factory.create()
}
