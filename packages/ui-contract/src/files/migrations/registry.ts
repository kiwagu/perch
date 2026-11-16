/**
 * Every migration of the engine, one per version from 1 up to `CONTRACT_VERSION`, ordered by the
 * version it reads: a bump of the version adds its step here.
 */

import type { Migration } from './migration'
import { oneToTwo } from './one-to-two'
import { twoToThree } from './two-to-three'

export const MIGRATIONS: ReadonlyArray<Migration> = [oneToTwo, twoToThree]
