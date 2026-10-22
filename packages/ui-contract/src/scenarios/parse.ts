/**
 * Reads one scenario file of `tests/e2e/scenarios`: a YAML front matter between two `---`
 * lines with the header (`tags`, an optional `activity`, `devices`, `data`), then Markdown
 * with fixed sections in any order: `# <title>`, a line `Where: <text>`, `## Scenario:
 * <sentence>`, `### Steps` with a numbered list and `### Expected result` with a bullet
 * list, each item at the start of its line (an indented one is no item: the lists do not
 * nest). Any line ending reads as `\n`. The id is the file's path, never written in it. A front matter that is
 * missing or not YAML, a header field the header schema refuses, a section missing, unknown
 * or repeated, a line outside any section and a list item of the wrong shape are problems,
 * each with its line where the parser knows it.
 */

import { englishErrors } from '../files/parse-file'
import { jsonPath } from '../files/problems'
import { parseYaml } from '../files/read-yaml'

import { type ScenarioHeader, scenarioHeaderSchema } from './header'
import { type Scenario, scenarioSchema } from './schema'

export interface ScenarioProblem {
  readonly line?: number
  readonly message: string
}

type Field = 'title' | 'where' | 'scenario'
type List = 'steps' | 'expected'

const FIELDS: ReadonlyArray<{ field: Field; pattern: RegExp; form: string }> = [
  { field: 'title', pattern: /^# (.+)$/, form: '# <title>' },
  { field: 'where', pattern: /^Where:(.*)$/, form: 'Where: <text>' },
  { field: 'scenario', pattern: /^## Scenario:(.*)$/, form: '## Scenario: <sentence>' },
]

const LISTS: ReadonlyArray<{ list: List; heading: string; item: RegExp; shape: string }> = [
  { list: 'steps', heading: '### Steps', item: /^\d+\.\s+(.+)$/, shape: '1. <step>' },
  { list: 'expected', heading: '### Expected result', item: /^-\s+(.+)$/, shape: '- <result>' },
]

const FENCE = '---'

/** A problem at `line`, or without one when the parser does not know it. */
const at = (line: number | undefined, message: string): ScenarioProblem =>
  line === undefined ? { message } : { line, message }

interface Parts {
  /** The lines of the front matter, from line 2 of the file. */
  readonly header: readonly string[]
  /** The lines after the front matter, from line `bodyLine` of the file. */
  readonly body: readonly string[]
  readonly bodyLine: number
}

function partsOf(markdown: string): Parts | ScenarioProblem {
  const lines = markdown.split('\n')

  if (lines[0]?.trim() !== FENCE) {
    return at(
      1,
      'no front matter: the file opens with a "---" line, the YAML header and a "---" line',
    )
  }

  const close = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE)

  return close === -1
    ? at(1, 'the front matter has no closing "---" line')
    : { header: lines.slice(1, close), body: lines.slice(close + 1), bodyLine: close + 2 }
}

/** The line of the file where the top-level key `key` of the front matter starts, or line 1. */
function keyLine(header: readonly string[], key: PropertyKey | undefined): number {
  const index =
    typeof key === 'string' ? header.findIndex((line) => line.startsWith(`${key}:`)) : -1

  return index === -1 ? 1 : index + 2
}

function readHeader(
  header: readonly string[],
  problems: ScenarioProblem[],
): ScenarioHeader | undefined {
  const data = parseYaml(header.join('\n'))

  if ('reason' in data) {
    const line = data.line === undefined ? 1 : data.line + 1

    problems.push(at(line, `the front matter is not YAML: ${data.reason}`))

    return undefined
  }

  const parsed = scenarioHeaderSchema.safeParse(data.value, { error: englishErrors })

  for (const issue of parsed.error?.issues ?? []) {
    const key = issue.path[0] ?? (issue.code === 'unrecognized_keys' ? issue.keys[0] : undefined)

    problems.push(at(keyLine(header, key), `${jsonPath(issue.path)}: ${issue.message}`))
  }

  return parsed.data
}

interface Body {
  readonly values: Partial<Record<Field, string>> & Record<List, string[]>
  /** The line each section starts on. */
  readonly lines: ReadonlyMap<string, number>
}

function readBody(lines: readonly string[], first: number, problems: ScenarioProblem[]): Body {
  const values: Body['values'] = { steps: [], expected: [] }
  const starts = new Map<string, number>()
  let current: (typeof LISTS)[number] | undefined

  const open = (name: Field | List, form: string, line: number): void => {
    if (starts.has(name)) {
      problems.push(at(line, `section "${form}" appears twice`))
    } else {
      starts.set(name, line)
    }
  }

  lines.forEach((raw, index) => {
    const text = raw.trim()
    const line = first + index

    if (text === '') {
      return
    }

    const field = FIELDS.find(({ pattern }) => pattern.test(text))
    const list = LISTS.find(({ heading }) => heading === text)

    if (field !== undefined) {
      current = undefined
      open(field.field, field.form, line)
      values[field.field] ??= field.pattern.exec(text)?.[1]?.trim() ?? ''
    } else if (list !== undefined) {
      current = list
      open(list.list, list.heading, line)
    } else if (text.startsWith('#')) {
      current = undefined
      problems.push(at(line, `unknown heading "${text}"`))
    } else if (current === undefined) {
      problems.push(at(line, `a line outside any section: "${text}"`))
    } else {
      const indented = raw.trimStart() !== raw
      const item = indented ? undefined : current.item.exec(text)?.[1]

      if (item === undefined) {
        problems.push(
          at(line, `not a "${current.shape}" item of "${current.heading}": "${raw.trimEnd()}"`),
        )
      } else {
        values[current.list].push(item.trim())
      }
    }
  })

  for (const { field: name, form } of FIELDS) {
    if (!starts.has(name)) {
      problems.push(at(undefined, `missing section "${form}"`))
    }
  }

  for (const { list: name, heading } of LISTS) {
    if (!starts.has(name)) {
      problems.push(at(undefined, `missing section "${heading}"`))
    }
  }

  return { values, lines: starts }
}

export function parseScenario(
  id: string,
  markdown: string,
): { scenario?: Scenario; problems: ScenarioProblem[] } {
  const parts = partsOf(markdown.replace(/\r\n?/g, '\n'))

  if ('message' in parts) {
    return { problems: [parts] }
  }

  const problems: ScenarioProblem[] = []
  const header = readHeader(parts.header, problems)
  const body = readBody(parts.body, parts.bodyLine, problems)

  if (problems.length > 0 || header === undefined) {
    return { problems }
  }

  const parsed = scenarioSchema.safeParse(
    { id, ...header, ...body.values },
    { error: englishErrors },
  )

  return parsed.success
    ? { scenario: parsed.data, problems: [] }
    : {
        problems: parsed.error.issues.map((issue) =>
          at(
            typeof issue.path[0] === 'string' ? body.lines.get(issue.path[0]) : undefined,
            `${jsonPath(issue.path)}: ${issue.message}`,
          ),
        ),
      }
}
