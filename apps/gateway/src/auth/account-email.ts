import { z } from '@workspace/zod'

/**
 * An account's email as the gateway takes it in: an address of at most 254 characters, the
 * longest one can be, turned to lower case as the directory keeps and matches it. An address in
 * any case is one account, and one key of the failed sign-ins limit.
 */
export const accountEmail = z.email().max(254).toLowerCase()
