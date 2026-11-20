/**
 * The profile of an account: what the user shows of themselves. It is keyed by a
 * profile id and belongs to exactly one identity.
 */

import { idSchemas } from '@workspace/ids'
import { CONTRACT_VALUES } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { textLength } from '../../../platform/text-length'

export const ProfileSchema = z.object({
  id: idSchemas.profile.schema,
  identity: idSchemas.identity.schema,
  name: z
    .string()
    .trim()
    .min(1)
    .refine((name) => textLength(name) <= CONTRACT_VALUES['profile.name'].maxLength),
  email: z.email(),
  bio: z
    .string()
    .refine((bio) => textLength(bio) <= CONTRACT_VALUES['profile.bio'].maxLength)
    .optional(),
  createdAt: z.date(),
})

export type Profile = z.infer<typeof ProfileSchema>
