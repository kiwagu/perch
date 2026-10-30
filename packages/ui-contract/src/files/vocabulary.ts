/**
 * Reads `contract/vocabulary.md`: the closed lists of the contract, one `## ` section
 * each, as Markdown tables whose first cell is the key. The sections are fixed; a
 * missing, unknown or repeated section, a row with the wrong number of cells or with an
 * empty cell (only the Playwright cell of a kind may stay empty), a key listed twice and a
 * missing `Contract version: N` line are problems.
 */

import { VOCABULARY_FILE } from './paths'
import type { Problem } from './problems'

interface Located {
  readonly meaning: string
  readonly where: string
}

export interface Vocabulary {
  version: number | undefined
  kinds: Record<string, string>
  suffixes: Record<string, string>
  attributes: Record<string, { on: string; meaning: string }>
  appStates: Record<string, string>
  containerStates: Record<string, string>
  rowStates: Record<string, Located>
  codes: Record<string, Located>
  choiceValues: Record<string, Record<string, string>>
  screenNames: Record<string, string>
  roles: Record<string, string>
  reserved: Record<string, string>
}

export const VOCABULARY_SECTIONS = [
  'Grammar',
  'Kinds',
  'Derived suffixes',
  'Attributes',
  'App states',
  'Container states',
  'Row states',
  'Codes',
  'Choice values',
  'Screen names in use',
  'Roles',
  'Reserved anchors',
] as const

type Section = (typeof VOCABULARY_SECTIONS)[number]

interface Row {
  readonly cells: readonly string[]
  readonly line: number
}

/** The columns of each section's table; the Grammar is prose. */
const COLUMNS: Readonly<Record<Exclude<Section, 'Grammar'>, readonly string[]>> = {
  Kinds: ['Kind', 'Meaning', 'Playwright'],
  'Derived suffixes': ['Suffix', 'Meaning'],
  Attributes: ['Attribute', 'On', 'Meaning'],
  'App states': ['State', 'Meaning'],
  'Container states': ['State', 'Meaning'],
  'Row states': ['State', 'Where', 'Meaning'],
  Codes: ['Code', 'Where', 'Meaning'],
  'Choice values': ['Anchor', 'Value', 'Meaning'],
  'Screen names in use': ['Screen', 'Meaning'],
  Roles: ['Role', 'Meaning'],
  'Reserved anchors': ['Anchor', 'Meaning'],
}

/** The one column a row may leave empty: a kind no Playwright locator finds. */
const OPTIONAL_COLUMN = { section: 'Kinds', column: 'Playwright' } as const

const VERSION_LINE = /^Contract version: (\d+)$/m
const SEPARATOR_ROW = /^\|[\s:|-]+\|$/

const isSection = (heading: string): heading is Section =>
  (VOCABULARY_SECTIONS as readonly string[]).includes(heading)

const unquote = (cell: string): string => cell.replace(/^`(.*)`$/, '$1')

const cellsOf = (line: string, unquoted: number): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell, index) => (index < unquoted ? unquote(cell.trim()) : cell.trim()))

interface RawRow {
  readonly text: string
  readonly line: number
}

/** The body rows of every section, by heading: the header and separator rows are skipped. */
function readSections(markdown: string, problems: Problem[]): Map<Section, RawRow[]> {
  const sections = new Map<Section, RawRow[]>()
  let current: RawRow[] | undefined
  let header = false

  markdown.split('\n').forEach((text, index) => {
    const line = index + 1

    if (text.startsWith('## ')) {
      const heading = text.slice(3).trim()

      current = undefined
      header = true

      if (isSection(heading) && sections.has(heading)) {
        problems.push({
          file: VOCABULARY_FILE,
          line,
          message: `section "${heading}" appears twice`,
        })
      } else if (isSection(heading)) {
        current = []
        sections.set(heading, current)
      } else {
        problems.push({ file: VOCABULARY_FILE, line, message: `unknown section "${heading}"` })
      }

      return
    }

    if (current === undefined || !text.trim().startsWith('|')) {
      return
    }

    if (header) {
      header = false
    } else if (!SEPARATOR_ROW.test(text.trim())) {
      current.push({ text, line })
    }
  })

  return sections
}

/** The rows of one section split into cells; a row of the wrong width is a problem. */
function tableOf(
  sections: Map<Section, RawRow[]>,
  section: Exclude<Section, 'Grammar'>,
  problems: Problem[],
): Row[] {
  const unquoted = section === 'Choice values' ? 2 : 1

  return (sections.get(section) ?? []).flatMap((row) => {
    const cells = cellsOf(row.text, unquoted)
    const columns = COLUMNS[section]

    if (cells.length !== columns.length) {
      problems.push({
        file: VOCABULARY_FILE,
        line: row.line,
        message: `section "${section}": a row has ${cells.length} cell(s), expected ${columns.length}`,
      })

      return []
    }

    columns.forEach((column, index) => {
      const optional = section === OPTIONAL_COLUMN.section && column === OPTIONAL_COLUMN.column

      if (!optional && cells[index] === '') {
        problems.push({
          file: VOCABULARY_FILE,
          line: row.line,
          message: `section "${section}": the "${column}" cell is empty`,
        })
      }
    })

    return [{ cells, line: row.line }]
  })
}

/** A map from the first cell of each row to what `value` makes of the row. */
function keyed<T>(
  rows: readonly Row[],
  section: Section,
  problems: Problem[],
  value: (cells: readonly string[]) => T,
): Record<string, T> {
  const map: Record<string, T> = {}

  for (const row of rows) {
    const key = row.cells[0] ?? ''

    if (key in map) {
      problems.push({
        file: VOCABULARY_FILE,
        line: row.line,
        message: `section "${section}": "${key}" is listed twice`,
      })
    } else {
      map[key] = value(row.cells)
    }
  }

  return map
}

const meaningOf = (cells: readonly string[]): string => cells[1] ?? ''

const locatedOf = (cells: readonly string[]): Located => ({
  where: cells[1] ?? '',
  meaning: cells[2] ?? '',
})

function choiceValuesOf(
  rows: readonly Row[],
  problems: Problem[],
): Record<string, Record<string, string>> {
  const byAnchor: Record<string, Row[]> = {}

  for (const row of rows) {
    const anchor = row.cells[0] ?? ''

    byAnchor[anchor] = [...(byAnchor[anchor] ?? []), { cells: row.cells.slice(1), line: row.line }]
  }

  return Object.fromEntries(
    Object.entries(byAnchor).map(([anchor, values]) => [
      anchor,
      keyed(values, 'Choice values', problems, meaningOf),
    ]),
  )
}

export function parseVocabulary(markdown: string): { vocabulary: Vocabulary; problems: Problem[] } {
  const problems: Problem[] = []
  const sections = readSections(markdown, problems)
  const version = VERSION_LINE.exec(markdown)?.[1]

  for (const section of VOCABULARY_SECTIONS) {
    if (!sections.has(section)) {
      problems.push({ file: VOCABULARY_FILE, message: `missing section "${section}"` })
    }
  }

  if (version === undefined) {
    problems.push({ file: VOCABULARY_FILE, message: 'no "Contract version: N" line' })
  }

  const table = (section: Exclude<Section, 'Grammar'>) => tableOf(sections, section, problems)
  const simple = (section: Exclude<Section, 'Grammar'>) =>
    keyed(table(section), section, problems, meaningOf)

  const vocabulary: Vocabulary = {
    version: version === undefined ? undefined : Number(version),
    kinds: simple('Kinds'),
    suffixes: simple('Derived suffixes'),
    attributes: keyed(table('Attributes'), 'Attributes', problems, (cells) => ({
      on: cells[1] ?? '',
      meaning: cells[2] ?? '',
    })),
    appStates: simple('App states'),
    containerStates: simple('Container states'),
    rowStates: keyed(table('Row states'), 'Row states', problems, locatedOf),
    codes: keyed(table('Codes'), 'Codes', problems, locatedOf),
    choiceValues: choiceValuesOf(table('Choice values'), problems),
    screenNames: simple('Screen names in use'),
    roles: simple('Roles'),
    reserved: simple('Reserved anchors'),
  }

  return { vocabulary, problems }
}
