/**
 * This device's own writes of the account's language, as the frame keeps them to tell the echo of
 * a write from a language another device stored: the shape that brings a stored language back may
 * arrive late, after a newer choice, and is then this device's own, not another device's. A store
 * says its language before it starts and again when it failed. The start provides it over the
 * frame's record.
 */

import type { ResultAsync } from 'neverthrow'
import { createContext, useContext } from 'react'

import type { Locale } from '@workspace/i18n'

export interface LanguageWrites {
  /**
   * A store of `locale` starts on this device; the function returned says that store failed, so
   * its language will not come back, and says nothing once the account changed since it began.
   */
  writing(locale: Locale): () => void
}

export const LanguageWritesContext = createContext<LanguageWrites | undefined>(undefined)

export function useLanguageWrites(): LanguageWrites {
  const writes = useContext(LanguageWritesContext)

  if (!writes) {
    throw new Error('useLanguageWrites needs the language writes the start provides')
  }

  return writes
}

/** A store of the account's language that tells `writes` of its write: before it starts, and when it failed. */
export function trackedStore<E>(
  writes: LanguageWrites,
  store: (locale: Locale) => ResultAsync<void, E>,
): (locale: Locale) => ResultAsync<void, E> {
  return (locale) => {
    const failed = writes.writing(locale)

    return store(locale).orTee(() => failed())
  }
}
