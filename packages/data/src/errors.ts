export type DataErrorCode =
  | 'data:OPEN_FAILED'
  | 'data:QUERY_FAILED'
  | 'data:COMMAND_FAILED'
  | 'data:WRITE_REJECTED'
  | 'data:WRITE_FAILED'
  | 'data:AUTH_FAILED'
  | 'data:INVALID_CREDENTIALS'
  | 'data:SIGN_UP_REJECTED'
  | 'data:SYNC_STOPPED'
  | 'data:PUSH_REJECTED'
  | 'data:OFFLINE'
  | 'data:RATE_LIMITED'
  | 'data:REGION_STALE'
  | 'data:REGION_RELOADED'
  | 'data:OTHER_ACCOUNT'

export interface DataError {
  readonly code: DataErrorCode
  readonly message: string
  readonly cause?: unknown
}

export function dataError(code: DataErrorCode, message: string, cause?: unknown): DataError {
  return cause === undefined ? { code, message } : { code, message, cause }
}
