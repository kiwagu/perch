/** The code a refused write rejected with, read off the error event of its invoke; else `fallback`. */
export function failureOf(event: object, fallback: string): string {
  const error = 'error' in event ? event.error : undefined

  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : fallback
}
