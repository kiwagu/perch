/** One screen file's steps: its flow expanded, then the screen parsed and its file name checked. */

import { isRecord } from '../../records'
import { screenFileSchema } from '../../schemas'
import { controlsOf } from '../derive'
import { type DerivedToast, expandFlow } from '../expand-flow'
import { parseFile } from '../parse-file'
import { screenFile } from '../paths'
import { jsonPath, type Problem } from '../problems'

import type { Lookups } from './lookups'
import type { Screen } from './types'

/** The problem of a screen kept in another file than the one its first binding names. */
function nameProblems(file: string, screen: Screen): Problem[] {
  const first = screen.bindings[0]?.path
  const named = screenFile(first)

  if (file === named) {
    return []
  }

  return [
    {
      file,
      message:
        first === undefined
          ? `a screen without bindings is the frame, whose file is ${named}`
          : `its first binding is "${first}", so its file is ${named}`,
    },
  ]
}

/** The screen of one file as read, its flow expanded, with the toasts the expansion derived. */
export function expandedOf(
  file: string,
  read: unknown,
  lookups: Lookups,
): { value?: unknown; toasts: readonly DerivedToast[]; problems: Problem[] } {
  const flow = isRecord(read) ? read['flow'] : undefined
  const id = isRecord(read) && typeof read['id'] === 'string' ? read['id'] : ''
  const expanded =
    flow === undefined
      ? undefined
      : expandFlow(flow, { ...lookups, controls: controlsOf(read), screen: id })

  if (expanded !== undefined && expanded.issues.length > 0) {
    return {
      toasts: [],
      problems: expanded.issues.map((issue) => ({
        file,
        message: `${jsonPath(issue.at)}: ${issue.message}`,
      })),
    }
  }

  return {
    value: expanded === undefined || !isRecord(read) ? read : { ...read, flow: expanded.flow },
    toasts: expanded?.toasts ?? [],
    problems: [],
  }
}

/** The screen of one file, expanded, parsed as every reader takes it. */
export function parsedOf(file: string, value: unknown): { screen?: Screen; problems: Problem[] } {
  const parsed = parseFile(file, screenFileSchema, value)

  if (parsed.value === undefined) {
    return { problems: parsed.problems }
  }

  const misnamed = nameProblems(file, parsed.value)

  return misnamed.length > 0 ? { problems: misnamed } : { screen: parsed.value, problems: [] }
}
