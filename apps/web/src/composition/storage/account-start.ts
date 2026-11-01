import { SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type {
  AccountStart,
  KeptStartPort,
} from '../../features/user/application/account-start.service'

import type { KeyValueStorage } from './key-value'

export const ACCOUNT_START_KEY = 'perch.session.account-start'

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

/**
 * The start of an account this browser keeps until its settings and its profile both exist, shared
 * by its tabs; a kept value it cannot read is none.
 */
export function keptAccountStart(storage: KeyValueStorage): KeptStartPort {
  return {
    keep: (start) => storage.set(ACCOUNT_START_KEY, JSON.stringify(start)),
    kept: (): AccountStart | undefined => {
      const value = storage.get(ACCOUNT_START_KEY)
      const parsed = value === undefined ? undefined : accountStart.safeParse(parsedJson(value))

      return parsed?.success ? parsed.data : undefined
    },
    forget: () => storage.remove(ACCOUNT_START_KEY),
  }
}
