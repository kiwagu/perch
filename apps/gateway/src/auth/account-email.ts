import { z } from '@workspace/zod'

/** The longest email an account has, in characters: the longest an address can be. */
export const MAX_EMAIL = 254

/**
 * An account's email as the gateway takes it in: an address of at most `MAX_EMAIL` characters, the
 * longest one can be, turned to lower case as the directory keeps and matches it. An address in
 * any case is one account, and one key of the failed sign-ins limit.
 */
export const accountEmail = z.email().max(MAX_EMAIL).toLowerCase()
