import { SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type {
  AccountStart,
  KeptStart,
  KeptStartPort,
} from '../../features/user/application/account-start.service'

import type { KeyValueStorage } from './key-value'
import { CURRENT_KEY, type SignInId } from './sign-in'

/** The start a sign-in keeps: `perch.session.account-start.<sign-in>`. */
const ACCOUNT_START_KEY_PREFIX = 'perch.session.account-start.'

/** The key of the start kept for sign-in `signIn`. */
export function accountStartKeyOf(signIn: SignInId): string {
  return `${ACCOUNT_START_KEY_PREFIX}${signIn}`
}

const accountStart = z.object({
  identity: idSchemas.identity.schema,
  name: z.string().min(1),
  locale: z.enum(SUPPORTED_LOCALES),
})

/** What a kept value says, when it is JSON at all. */
function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** The start kept for sign-in `signIn`; a kept value it cannot read is none. */
function startOf(storage: KeyValueStorage, signIn: SignInId): AccountStart | undefined {
  const value = storage.get(accountStartKeyOf(signIn))
  const parsed = value === undefined ? undefined : accountStart.safeParse(parsedJson(value))

  return parsed?.success ? parsed.data : undefined
}

/**
 * The start of an account this browser keeps until its settings and its profile both exist,
 * shared by its tabs, under the sign-in that learnt of it: the start of the sign-in current now
 * is read, and only the one read is forgotten, so a finish that ends after another sign-in kept
 * its own forgets nothing of it; the ending of a sign-in forgets its start.
 */
export function keptAccountStart(storage: KeyValueStorage): KeptStartPort {
  return {
    keep: (signIn, start) => storage.set(accountStartKeyOf(signIn), JSON.stringify(start)),
    kept: (identity): KeptStart | undefined => {
      const signIn = storage.get(CURRENT_KEY)
      const start = signIn === undefined ? undefined : startOf(storage, signIn)

      return signIn !== undefined && start?.identity === identity ? { ...start, signIn } : undefined
    },
    forget: (start) => storage.remove(accountStartKeyOf(start.signIn)),
  }
}

/** Forgets the start sign-in `signIn` kept, if any; the starts of other sign-ins stay. */
export function forgetAccountStart(storage: KeyValueStorage, signIn: SignInId): void {
  storage.remove(accountStartKeyOf(signIn))
}
