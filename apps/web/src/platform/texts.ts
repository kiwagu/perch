import type { Translate } from '@workspace/i18n'

/** What a channel of the frame says for each code it shows, in the language the app speaks. */
export type Texts = Readonly<Record<string, (t: Translate) => string>>

/** The words of `code` on `channel`; a code without words is a gap in the frame's map, never shown silent. */
export function textOf(texts: Texts, code: string, channel: string): (t: Translate) => string {
  const text = texts[code]

  if (text === undefined) {
    throw new Error(`the ${channel} has no text for the code ${code}`)
  }

  return text
}
