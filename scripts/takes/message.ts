/**
 * A commit message as git records it, read for the take check: its subject and its trailers. How
 * git cleans the message up (`command.ts`) says whether what follows the scissors line is left
 * out and whether comment lines are stripped; where git's default leaves that to whether an editor
 * opened, the message is read both ways, and whether the two agree is part of what the check
 * judges.
 */

import { readFileSync } from 'node:fs'

import { git } from '../staged-commit.ts'

import type { Cleanup } from './command.ts'

export interface Trailer {
  readonly key: string
  readonly value: string
}

export interface Message {
  readonly subject: string
  readonly trailers: readonly Trailer[]
  /** Whether the subject and the trailers are the same however git's cleanup mode reads them. */
  readonly alike: boolean
}

type Reading = Pick<Message, 'subject' | 'trailers'>

/** The line git cuts a message at, a comment line of its own: `<comment> -------- >8 --------`. */
function scissors(comments: readonly string[]): RegExp {
  const marks = comments.map((comment) => comment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  return new RegExp(`^(?:${marks.join('|')}) -{24} >8 -{24}$`, 'm')
}

/** The subject and trailers of `text` cleaned up by git in `mode`. */
function reading(text: string, mode: 'strip' | 'whitespace' | 'verbatim'): Reading | undefined {
  let cleaned = text

  if (mode !== 'verbatim') {
    const stripped = git(['stripspace', ...(mode === 'strip' ? ['--strip-comments'] : [])], text)

    if (stripped.status !== 0) {
      return undefined
    }

    cleaned = stripped.out
  }

  const parsed = git(['interpret-trailers', '--parse'], cleaned)

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
  const subject = cleaned.split('\n').find((line) => line.trim() !== '') ?? ''

  return { subject, trailers }
}

/** The message in `file` as git records it after `cleanup`, or undefined when it cannot be read. */
export function readMessage(file: string, cleanup: Cleanup): Message | undefined {
  let text: string

  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }

  const kept = cleanup.cut ? text.slice(0, scissors(cleanup.comments).exec(text)?.index) : text
  const modes = cleanup.mode === 'either' ? (['strip', 'whitespace'] as const) : [cleanup.mode]
  const [first, ...others] = modes.map((mode) => reading(kept, mode))

  if (first === undefined || others.some((other) => other === undefined)) {
    return undefined
  }

  const alike = others.every((other) => JSON.stringify(other) === JSON.stringify(first))

  return { ...first, alike }
}
