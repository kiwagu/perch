/**
 * The profile of an account: what the user shows of themselves. It is keyed by a
 * profile id and belongs to exactly one identity.
 */

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { textLength } from '../../../platform/text-length'

export const PROFILE_NAME_MAX = 80

/** The longest bio, in characters; the server's schema holds the same bound. */
export const PROFILE_BIO_MAX = 2000

export const ProfileSchema = z.object({
  id: idSchemas.profile.schema,
  identity: idSchemas.identity.schema,
  name: z
    .string()
    .trim()
    .min(1)
    .refine((name) => textLength(name) <= PROFILE_NAME_MAX),
  email: z.email(),
  bio: z
    .string()
    .refine((bio) => textLength(bio) <= PROFILE_BIO_MAX)
    .optional(),
  createdAt: z.date(),
})

export type Profile = z.infer<typeof ProfileSchema>
