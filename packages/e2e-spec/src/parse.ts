import { err, ok, type Result } from 'neverthrow'

export interface TestDatum {
  readonly name: string
  readonly value: string
  /** `generate`: the test creates a fresh value; otherwise `value` is used as written. */
  readonly generate: boolean
}

/** An instruction-style e2e spec: what a person would follow to check the feature by hand. */
export interface SpecDoc {
  readonly title: string
  readonly role: string
  readonly where: string
  readonly testData: readonly TestDatum[]
  readonly scenario: string
  readonly steps: readonly string[]
  readonly expected: readonly string[]
}

type ListSection = 'testData' | 'steps' | 'expected'

const LIST_HEADINGS: Readonly<Record<string, ListSection>> = {
  '## Test data': 'testData',
  '### Steps': 'steps',
  '### Expected result': 'expected',
}

const ITEM_PATTERNS: Readonly<Record<ListSection, RegExp>> = {
  testData: /^-\s+(.+)$/,
  steps: /^\d+\.\s+(.+)$/,
  expected: /^-\s+(.+)$/,
}

function toDatum(item: string): TestDatum | undefined {
  const match = /^([^:]+):\s*(.+)$/.exec(item)

  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const value = match[2].trim()
  const quoted = /^"(.*)"$/.exec(value)

  return {
    name: match[1].trim(),
    value: quoted?.[1] ?? value,
    generate: value === 'generate',
  }
}

/**
 * Reads a spec. The headings are fixed and may come in any order; an unknown
 * heading, a line outside any section or a missing section is a problem.
 */
export function parseSpec(markdown: string): Result<SpecDoc, readonly string[]> {
  const problems: string[] = []
  const fields = new Map<string, string>()
  const lists: Record<ListSection, string[]> = { testData: [], steps: [], expected: [] }
  const seen = new Set<string>()
  let section: ListSection | undefined

  for (const line of markdown.split('\n').map((raw) => raw.trim())) {
    if (line === '') {
      continue
    }

    const title = /^# (.+)$/.exec(line)?.[1]
    const scenario = /^## Scenario:\s*(.+)$/.exec(line)?.[1]
    const field = /^(Role|Where):\s*(.+)$/.exec(line)
    const heading = LIST_HEADINGS[line]

    if (title || scenario) {
      section = undefined
      fields.set(title ? 'title' : 'scenario', (title ?? scenario ?? '').trim())
    } else if (heading) {
      section = heading
      seen.add(line)
    } else if (line.startsWith('#')) {
      section = undefined
      problems.push(`unknown heading "${line}"`)
    } else if (field?.[1] && field[2]) {
      fields.set(field[1].toLowerCase(), field[2].trim())
    } else if (section) {
      const item = ITEM_PATTERNS[section].exec(line)?.[1]

      if (item) {
        lists[section].push(item.trim())
      } else {
        problems.push(`not an item of its section: "${line}"`)
      }
    } else {
      problems.push(`a line outside any section: "${line}"`)
    }
  }

  const required: ReadonlyArray<readonly [string, string]> = [
    ['title', '# <title>'],
    ['role', 'Role: <role>'],
    ['where', 'Where: <place>'],
    ['scenario', '## Scenario: <sentence>'],
  ]

  for (const [key, form] of required) {
    if (!fields.has(key)) {
      problems.push(`missing section "${form}"`)
    }
  }

  for (const heading of Object.keys(LIST_HEADINGS)) {
    if (!seen.has(heading)) {
      problems.push(`missing section "${heading}"`)
    }
  }

  const testData = lists.testData.map(toDatum)

  testData.forEach((datum, index) => {
    if (!datum) {
      problems.push(
        `test data needs "Name: generate" or "Name: \\"value\\"": "${lists.testData[index]}"`,
      )
    }
  })

  if (problems.length > 0) {
    return err(problems)
  }

  return ok({
    title: fields.get('title') ?? '',
    role: fields.get('role') ?? '',
    where: fields.get('where') ?? '',
    testData: testData.filter((datum): datum is TestDatum => datum !== undefined),
    scenario: fields.get('scenario') ?? '',
    steps: lists.steps,
    expected: lists.expected,
  })
}
