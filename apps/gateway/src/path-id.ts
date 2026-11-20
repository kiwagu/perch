import { CONTRACT_VALUES } from '@workspace/kernel'

/**
 * Whether `id` is longer than a path of the gateway may carry: the platform's `id` value allows
 * far more than any id the gateway issues, so a longer text names no record. A route refuses one
 * before it looks for the record it names, as a request that does not follow its schema.
 */
export const idTooLong = (id: string): boolean => id.length > CONTRACT_VALUES.id.maxLength
