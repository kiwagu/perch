/**
 * The texts of the vocabulary's tables, in the file's order, for the synonym check: each row's key
 * and its meaning, a choice value's under its anchor, which is read where it is declared (or as
 * a part its base derives) and not again here. The Grammar is prose about the engine, not a
 * table; the Roles section is left out, since a contract keeps its roles in its terms file and
 * their meanings are read there.
 */

import type { Vocabulary } from '../files'

export interface VocabularyText {
  /** The row: `section "Codes", failed`; a choice value's names its anchor too. */
  readonly place: string
  readonly kind: 'key' | 'meaning'
  readonly text: string
}

type Row = string | { readonly meaning: string }

const TABLES = [
  ['Kinds', 'kinds'],
  ['Derived suffixes', 'suffixes'],
  ['Attributes', 'attributes'],
  ['App states', 'appStates'],
  ['Container states', 'containerStates'],
  ['Row states', 'rowStates'],
  ['Field states', 'fieldStates'],
  ['Codes', 'codes'],
  ['Choice values', 'choiceValues'],
  ['Screen names in use', 'screenNames'],
  ['Reserved anchors', 'reserved'],
  ['Composites', 'composites'],
] as const satisfies readonly (readonly [string, keyof Vocabulary])[]

const meaningOf = (row: Row): string => (typeof row === 'string' ? row : row.meaning)

/** The key and the meaning of each row of `rows`, the key read as `key`, placed by `name`. */
const textsOf = (
  section: string,
  rows: readonly (readonly [name: string, key: string, meaning: string])[],
): VocabularyText[] =>
  rows.flatMap(([name, key, meaning]) => {
    const place = `section "${section}", ${name}`

    return [
      { place, kind: 'key', text: key },
      { place, kind: 'meaning', text: meaning },
    ]
  })

export function vocabularyTexts(vocabulary: Vocabulary): VocabularyText[] {
  return TABLES.flatMap(([section, field]) =>
    field === 'choiceValues'
      ? textsOf(
          section,
          Object.entries(vocabulary.choiceValues).flatMap(([anchor, values]) =>
            Object.entries(values).map(
              ([value, meaning]) => [`${anchor} ${value}`, value, meaning] as const,
            ),
          ),
        )
      : textsOf(
          section,
          Object.entries<Row>(vocabulary[field]).map(
            ([key, row]) => [key, key, meaningOf(row)] as const,
          ),
        ),
  )
}
