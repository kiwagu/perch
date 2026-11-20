import type { ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { DataError } from '@workspace/data'
import type { ProfileId } from '@workspace/ids'

import type { ProfileValues } from './context'

export type SignOutOutcome = 'signed-out' | 'needs-confirmation'

export interface ProfileMachineDeps {
  readonly profiles: {
    readonly updateName: (input: {
      readonly id: ProfileId
      readonly name: string
    }) => ResultAsync<void, BusError>
    readonly updateBio: (input: {
      readonly id: ProfileId
      readonly bio: string
    }) => ResultAsync<void, BusError>
  }
  readonly signOut: (options?: {
    readonly forgetUnsent: true
  }) => ResultAsync<SignOutOutcome, DataError>
  /** Read at each guard and each write: what the page holds now. */
  readonly values: () => ProfileValues
}
