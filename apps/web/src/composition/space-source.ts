/**
 * Where the application's current-space ports find the signed-in identity's space, and how
 * they say that nobody is signed in.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { IdentitySpace } from './identity-space'

/** The current space, and how to hear that it changed. */
export interface SpaceSource {
  current(): IdentitySpace | undefined
  onSwitch(listener: () => void): () => void
  /**
   * The saved identity's space opens at the start, and settles once it is open or did not open;
   * undefined otherwise. What is read or written meanwhile waits for it instead of refusing.
   */
  opening(): PromiseLike<unknown> | undefined
  /**
   * A sign-out runs in this tab or another one of the browser: a write landing after its final
   * drain would be deleted with the database, so none is taken until it ends.
   */
  signingOut(): boolean
  /**
   * Runs a write admitted into `space` while holding the identity's write lock shared, until
   * its change is durable: a sign-out deletes the database only once no write of any tab runs.
   */
  writing<T>(space: IdentitySpace, work: () => ResultAsync<T, DataError>): ResultAsync<T, DataError>
}

/** Why a read or write refuses while nobody is signed in. */
export const signedOut = (what: string): string =>
  `sign in first: ${what} needs the signed-in identity`
