/**
 * The checkout's baseline `refactor-baseline.json`: a machine-local, gitignored map of path to
 * line count for every measured file at or above the red threshold.
 */

import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

export type Baseline = Readonly<Record<string, number>>

export const BASELINE_PATH = 'refactor-baseline.json'

/** The baseline of this checkout, or undefined when none has been written yet. */
export function readBaseline(): Baseline | undefined {
  if (!existsSync(BASELINE_PATH)) {
    return undefined
  }

  const text = readFileSync(BASELINE_PATH, 'utf8').trim()

  if (text === '') {
    console.error(`${BASELINE_PATH}: empty; write \`{}\` or run --update-baseline`)
    process.exit(2)
  }

  const parsed: unknown = JSON.parse(text)

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`${BASELINE_PATH}: expected an object of path -> lines`)
    process.exit(2)
  }

  for (const [path, lines] of Object.entries(parsed)) {
    if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 0) {
      console.error(`${BASELINE_PATH}: "${path}" must map to a non-negative integer`)
      process.exit(2)
    }
  }

  return parsed as Baseline
}

/** The file content of a baseline, its paths sorted. */
export function baselineText(baseline: Baseline): string {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)))

  return `${JSON.stringify(sorted, null, 2)}\n`
}

/**
 * Publishes a complete baseline under its final name in one step, so no reader ever sees a
 * partial file: the content goes to a temp file first; an update renames it over the old
 * baseline, an adoption hard-links it to the final name, which fails with EEXIST when a
 * concurrent adopter got there first (false: the file now holds that run's baseline). The
 * temp file is removed on every path.
 */
export function publishBaseline(content: string, adopting: boolean): boolean {
  const temp = `${BASELINE_PATH}.${process.pid}.tmp`

  try {
    writeFileSync(temp, content)

    if (!adopting) {
      renameSync(temp, BASELINE_PATH)

      return true
    }

    try {
      linkSync(temp, BASELINE_PATH)

      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false
      }

      throw error
    }
  } finally {
    rmSync(temp, { force: true })
  }
}
