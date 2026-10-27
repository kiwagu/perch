import type { Translate } from '@workspace/i18n'

/** What a channel of the frame says for each code it shows, in the language the app speaks. */
export type Texts = Readonly<Record<string, (t: Translate) => string>>

/**
 * The entry of `code` in a channel's map (its words, and for a toast its tone); a code without one
 * is a gap in the frame's map, never shown silent.
 */
export function entryOf<T>(map: Readonly<Record<string, T>>, code: string, channel: string): T {
  const entry = map[code]

  if (entry === undefined) {
    throw new Error(`the ${channel} has no text for the code ${code}`)
  }

  return entry
}
