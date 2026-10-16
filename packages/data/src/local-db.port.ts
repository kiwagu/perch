import { token } from '@workspace/di'

import type { LocalDb } from './types'

export type LocalDbPort = LocalDb

export const LOCAL_DB = token<LocalDbPort>('LocalDb')
