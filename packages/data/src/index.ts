export type { Engines } from 'surrealdb'

export type { AuthUser, SignInInput, SignUpInput } from './auth.port'
export { CHANGE_EVENT, onChange, publishChange } from './changes'
export { runCommand } from './commands'
export { type DataError, type DataErrorCode, dataError } from './errors'
export { applySchema, deleteLocalDb, type OpenLocalDbOptions, openLocalDb } from './local-db'
export { LOCAL_DB, type LocalDbPort } from './local-db.port'
export { type OperatorOptions, runAsOperator } from './operator'
export { ShapeRunner, type WatchOptions } from './shape-runner'
export { SHAPE_RUNNER, type ShapeRunnerPort } from './shape-runner.port'
export {
  camelCase,
  pascalCase,
  type SurqlRole,
  surqlComponentFile,
  surqlExportName,
} from './surql-names'
export { tenantDatabase, tenantRegionId } from './tenant'
export type {
  ChangeOrigin,
  Command,
  LocalDb,
  ParamDecl,
  ParamsSchema,
  Region,
  Shape,
  TableChange,
  ValidationOutcome,
} from './types'
export {
  fromDriverValue,
  type RecordRef,
  recordId,
  recordRef,
  recordTableOf,
  toDriverParams,
} from './values'
export { SurrealWritePath } from './write-path'
export { type CommandMeta, WRITE_PATH, type WritePathPort } from './write-path.port'
