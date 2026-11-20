/**
 * The longest id a path of the gateway carries, in characters: the platform's `id` value allows
 * 64, far more than any id the gateway issues, so a longer text names no record. A route refuses
 * one before it looks for the record it names, as a request that does not follow its schema.
 */
export const MAX_PATH_ID = 64

/** Whether `id` is longer than a path may carry. */
export const idTooLong = (id: string): boolean => id.length > MAX_PATH_ID
