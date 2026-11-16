/**
 * Every migration of the engine, one per version from 1 up to `CONTRACT_VERSION`, ordered by the
 * version it reads: a bump of the version adds its step here.
 */

import { fiveToSix } from './five-to-six'
import { fourToFive } from './four-to-five'
import type { Migration } from './migration'
import { oneToTwo } from './one-to-two'
import { threeToFour } from './three-to-four'
import { twoToThree } from './two-to-three'

export const MIGRATIONS: ReadonlyArray<Migration> = [
  oneToTwo,
  twoToThree,
  threeToFour,
  fourToFive,
  fiveToSix,
]
