/**
 * A commit message as git records it, read for the take check: its subject and its trailers. How
 * git cleans the message up (`command.ts`) says whether what follows the scissors line is left
 * out and whether comment lines are stripped; where git's default leaves that to whether an editor
 * opened, the message is read both ways, and where git picks its comment character per commit
 * (`core.commentChar=auto`), with each it may pick. Whether the readings agree is part of what the
 * check judges.
 */

import { readFileSync } from 'node:fs'

import { git } from '../staged-commit.ts'

import type { Cleanup } from './command.ts'

export interface Trailer {
  readonly key: string
  readonly value: string
}

/** What could make git record a message otherwise than it reads: its comment lines, or its comment character. */
export type Doubt = 'comment-lines' | 'comment-character'

export interface Message {
  readonly subject: string
  readonly trailers: readonly Trailer[]
  /** Why the readings of the message disagree, or undefined where they agree. */
  readonly doubt: Doubt | undefined
}

export type Reading = Pick<Message, 'subject' | 'trailers'>

/** The line git cuts a message at, a comment line of its own: `<comment> -------- >8 --------`. */
function scissors(comment: string): RegExp {
  return new RegExp(`^${comment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -{24} >8 -{24}$`, 'm')
}

/**
 * The subject and trailers of `text` as git reads them: the subject its first line that is not
 * blank, the trailers what `git interpret-trailers --parse` lists, each split at its first colon,
 * the value trimmed; comment lines start with `comment` where one is given, else with what the
 * repository's own setting says. Undefined when git cannot read them.
 */
export function readingOf(text: string, comment?: string): Reading | undefined {
  const as = comment === undefined ? [] : ['-c', `core.commentString=${comment}`]
  const parsed = git([...as, 'interpret-trailers', '--parse'], text)

  if (parsed.status !== 0) {
    return undefined
  }

  const trailers = parsed.out
    .split('\n')
    .filter((line) => line.includes(':'))
    .map((line) => {
      const colon = line.indexOf(':')

      return { key: line.slice(0, colon), value: line.slice(colon + 1).trim() }
    })
  const subject = text.split('\n').find((line) => line.trim() !== '') ?? ''

  return { subject, trailers }
}

/** The subject and trailers of `text` cleaned up by git in `mode`, comment lines starting with `comment`. */
function reading(
  text: string,
  mode: 'strip' | 'whitespace' | 'verbatim',
  comment: string,
): Reading | undefined {
  if (mode === 'verbatim') {
    return readingOf(text, comment)
  }

  const stripped = git(
    [
      '-c',
      `core.commentString=${comment}`,
      'stripspace',
      ...(mode === 'strip' ? ['--strip-comments'] : []),
    ],
    text,
  )

  return stripped.status === 0 ? readingOf(stripped.out, comment) : undefined
}

/** The message in `file` as git records it after `cleanup`, or undefined when it cannot be read. */
export function readMessage(file: string, cleanup: Cleanup): Message | undefined {
  let text: string

  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }

  const modes = cleanup.mode === 'either' ? (['strip', 'whitespace'] as const) : [cleanup.mode]
  const rows = cleanup.comments.map((comment) => {
    const kept = cleanup.cut ? text.slice(0, scissors(comment).exec(text)?.index) : text

    return modes.map((mode) => reading(kept, mode, comment))
  })
  const readings = rows.flat()
  const first = readings[0]

  if (first === undefined || readings.some((one) => one === undefined)) {
    return undefined
  }

  const same = (one: Reading | undefined): boolean => JSON.stringify(one) === JSON.stringify(first)
  const lines = rows.every((row) =>
    row.every((one) => JSON.stringify(one) === JSON.stringify(row[0])),
  )
  const doubt = !lines ? 'comment-lines' : readings.every(same) ? undefined : 'comment-character'

  return { ...first, doubt }
}
