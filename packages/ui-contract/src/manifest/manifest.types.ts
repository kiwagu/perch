/** The manifest and its parts, typed from the Zod source of its schema. */

import type { z } from '@workspace/zod'

import type { manifestSchema } from '../schemas'

export type Manifest = z.output<typeof manifestSchema>

export type Product = Manifest['product']

export type Instructions = Manifest['contract']['instructions']
