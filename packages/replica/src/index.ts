import type { ChangeSpec } from '@workspace/kernel'

/** A replica operation is a kernel change spec; commands compile into lists of them. */
export type ReplicaOp = ChangeSpec

export { recordKey, splitRecordKey } from './keys'
export { Projector, type ProjectorOptions } from './projector'
export { type OpenRegionOptions, RegionDoc, type RegionRef } from './region-doc'
export { fieldOf, type ReplicaField, type ReplicaSchema } from './schema'
export { LoroWritePath, type LoroWritePathOptions } from './write-path'
