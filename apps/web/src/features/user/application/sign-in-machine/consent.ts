/**
 * The account a sign-in refused at the limit of devices asked about (`consentFor`), read off the
 * error event of its invoke: a passkey sign-in names it, which its confirmation must name again;
 * none for any other event or refusal.
 */
export function consentOf(event: object): string | undefined {
  const error = 'error' in event ? event.error : undefined

  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'data:DEVICE_LIMIT' &&
    'consentFor' in error &&
    typeof error.consentFor === 'string'
    ? error.consentFor
    : undefined
}
