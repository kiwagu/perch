import { dataError } from '@workspace/data'

/** The failure of a sign-in whose session was closed meanwhile: a later transition started. */
export const closedDuringSignIn = () =>
  dataError('data:AUTH_FAILED', 'the session was closed during this sign-in')
