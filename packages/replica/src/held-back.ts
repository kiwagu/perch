import { type DataError, dataError } from '@workspace/data'

/**
 * The failure of a server update that a local update before it held back: the local update failed
 * to persist, and the server's cannot be stored ahead of it. The write that made the local update
 * hears of that failure, so this one adds nothing to it.
 */
export interface HeldBack extends DataError {
  readonly heldBack: true
}

/** The failure of a server update of `region` held back by `local`, a local update's failure to persist. */
export function heldBack(region: string, local: DataError): HeldBack {
  return {
    ...dataError(
      'data:WRITE_FAILED',
      `a server update of ${region} waits for a local update that failed to persist`,
      local,
    ),
    heldBack: true,
  }
}

/** Whether a server update failed only because a local update before it failed to persist. */
export function isHeldBack(error: DataError): error is HeldBack {
  return 'heldBack' in error && error.heldBack === true
}
