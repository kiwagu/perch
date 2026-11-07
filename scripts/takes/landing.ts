/**
 * What the take check says of the commits a branch lands on `main`: nothing when every commit of
 * its round is in a take's form, as git recorded it; otherwise the refusal naming each commit that
 * is not, with round 1's problems under it, ending with the form.
 */

import { git } from '../staged-commit.ts'

import { FORM } from './form.ts'
import { recordedFiles, recordedMessage } from './recorded.ts'
import { takeRefusal } from './refusal.ts'
import { type Round, roundOf } from './round.ts'

const PREFIX = 'contract take: '

/** The short id of the commit `rev` names, or undefined when git knows none. */
export function shortOf(rev: string): string | undefined {
  const { status, out } = git(['rev-parse', '--short', '--verify', '--quiet', `${rev}^{commit}`])

  return status === 0 ? out.trim() : undefined
}

/** The problems of a commit's `refusal`, its own label and the form left out, indented under its line. */
function problemsOf(refusal: string): readonly string[] {
  const ending = `\n${FORM}`
  const body = refusal.endsWith(ending) ? refusal.slice(0, -ending.length) : refusal

  return body
    .split('\n')
    .map(
      (line, index) =>
        `  ${index === 0 && line.startsWith(PREFIX) ? line.slice(PREFIX.length) : line}`,
    )
}

/** The lines the refusal gives `commit`, oldest first in the round, or none when it is in its form. */
function faultsOf(branch: string, commit: string): readonly string[] {
  const message = recordedMessage(commit)
  const files = recordedFiles(commit)

  if (message === undefined || files === undefined) {
    return [
      `- ${commit.slice(0, 7)}`,
      "  git cannot read this commit's message or the files it changes.",
    ]
  }

  const refusal = takeRefusal(branch, message, files)

  if (refusal === undefined) {
    return []
  }

  const label = git(['log', '-1', '--format=%h %s', commit])
  const line = label.status === 0 ? label.out.trim() : `${commit.slice(0, 7)} ${message.subject}`

  return [`- ${line}`, ...problemsOf(refusal)]
}

/** The line naming the earlier tips the clone lacks, `missing`, or none when it has them all. */
function lacking(missing: readonly string[]): readonly string[] {
  const [one] = missing

  if (one === undefined) {
    return []
  }

  if (missing.length === 1) {
    return [
      `An earlier landing names ${one}, which this clone lacks: commits under it are judged again; fetch the branch that landed them if one of these is among them.`,
    ]
  }

  const named = `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`

  return [
    `Earlier landings name ${named}, which this clone lacks: commits under them are judged again; fetch the branches that landed them if one of these is among them.`,
  ]
}

/**
 * The refusal of landing `branch` at `tip` on `parent`: each commit of its round, read here or
 * given as `round`, that is not in a take's form, named with what is wrong with it; or undefined
 * when every one is.
 */
export function roundRefusal(
  branch: string,
  tip: string,
  parent: string,
  round?: Round,
): string | undefined {
  const short = shortOf(tip)

  if (short === undefined) {
    return `${PREFIX}git knows no commit ${tip}, the tip of ${branch}, in this clone.`
  }

  const judged = round ?? roundOf(tip, parent)

  if (typeof judged === 'string') {
    return `${PREFIX}on ${branch}, ${judged}`
  }

  const faults = judged.commits.flatMap((commit) => faultsOf(branch, commit))

  if (faults.length === 0) {
    return undefined
  }

  return [
    `${PREFIX}${branch} (${short}) carries commits that are not in a take's form:`,
    ...faults,
    `Rewrite them on ${branch} before landing (a message: reword it; a commit that mixes the business layer with other files: split it); a branch that was pushed is rewritten only on the developer's word.`,
    ...lacking(judged.missing),
    FORM,
  ].join('\n')
}
