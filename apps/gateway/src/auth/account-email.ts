import { CONTRACT_VALUES } from '@workspace/kernel'
import { z } from '@workspace/zod'

/**
 * An account's email as the gateway takes it in: an address of at most the `email` value's length,
 * turned to lower case as the directory keeps and matches it. An address in any case is one
 * account, and one key of the failed sign-ins limit.
 */
export const accountEmail = z.email().max(CONTRACT_VALUES.email.maxLength).toLowerCase()
