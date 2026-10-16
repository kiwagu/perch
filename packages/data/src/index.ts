export { type AuthOptions, createAuth } from './auth'
export {
  AUTH,
  type AuthPort,
  type AuthUser,
  type SignInInput,
  type SignUpInput,
} from './auth.port'
export { CHANGE_EVENT, onChange, publishChange } from './changes'
export { runCommand } from './commands'
export { type DataError, type DataErrorCode, dataError } from './errors'
export { type OpenLocalDbOptions, openLocalDb } from './local-db'
export { LOCAL_DB, type LocalDbPort } from './local-db.port'
export { ShapeRunner, type WatchOptions } from './shape-runner'
export { SHAPE_RUNNER, type ShapeRunnerPort } from './shape-runner.port'
export type { ChangeOrigin, Command, LocalDb, Region, Shape, TableChange } from './types'
export { SurrealWritePath } from './write-path'
export { WRITE_PATH, type WritePathPort } from './write-path.port'
