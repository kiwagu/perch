import type { ChangeSpec } from '@workspace/kernel'

/** A replica operation is a kernel change spec; commands compile into lists of them. */
export type ReplicaOp = ChangeSpec

export { type Clock, systemClock } from './clock'
export { recordKey, splitRecordKey } from './keys'
export { toColumns } from './projection-values'
export { Projector, type ProjectorOptions } from './projector'
export {
  type ImportOutcome,
  type OpenRegionOptions,
  type OutboxRow,
  RegionDoc,
  type RegionRef,
} from './region-doc'
export {
  fieldOf,
  type ReplicaField,
  type ReplicaSchema,
  type ReplicaTable,
  tablesOf,
} from './schema'
export { LoroWritePath, type LoroWritePathOptions } from './write-path'
