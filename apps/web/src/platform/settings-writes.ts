/**
 * This tab's own writes of the account's settings, as the frame keeps them to tell the echo of a
 * write from a value another tab or device stored: the shape that brings a stored value back may
 * arrive late, after a newer choice, and is then this tab's own, not another's. A store says its
 * value before it starts and again when it failed. The start provides them over the frame's
 * record, one per setting.
 */

import type { ResultAsync } from 'neverthrow'
import { createContext, useContext } from 'react'

import type { Locale } from '@workspace/i18n'

/** This tab's writes of one setting. */
export interface SettingWriting<T> {
  /**
   * A store of `value` starts in this tab; the function returned says that store failed, so its
   * value will not come back, and says nothing once the account changed since it began.
   */
  writing(value: T): () => void
}

/** This tab's writes of each setting the frame follows. */
export interface SettingsWrites {
  readonly locale: SettingWriting<Locale>
}

export const SettingsWritesContext = createContext<SettingsWrites | undefined>(undefined)

export function useSettingsWrites(): SettingsWrites {
  const writes = useContext(SettingsWritesContext)

  if (!writes) {
    throw new Error('useSettingsWrites needs the settings writes the start provides')
  }

  return writes
}

/** A store of a setting that tells `writes` of its write: before it starts, and when it failed. */
export function trackedStore<T, E>(
  writes: SettingWriting<T>,
  store: (value: T) => ResultAsync<void, E>,
): (value: T) => ResultAsync<void, E> {
  return (value) => {
    const failed = writes.writing(value)

    return store(value).orTee(() => failed())
  }
}
