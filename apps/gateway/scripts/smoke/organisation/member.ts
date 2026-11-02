import type { RegionDoc } from '@workspace/replica'

import type { SmokeDevice } from '../device'
import type { SignedIn } from '../http'

/** A member of the region as the smoke drives it: who signed in, its device and its document. */
export interface Member {
  readonly signedIn: SignedIn
  readonly device: SmokeDevice
  readonly doc: RegionDoc
}
