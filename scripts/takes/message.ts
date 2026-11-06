/**
 * A commit message as git records it, read for the take check: its subject and its trailers, the
 * comments and what `git commit --verbose` shows below its scissors line left out.
 */

import { readFileSync } from 'node:fs'

import { git } from '../staged-commit.ts'

/** The line `git commit --verbose` writes above the diff it shows, which is no part of the message. */
const SCISSORS = /^\S+ -{24} >8 -{24}$/m

export interface Trailer {
  readonly key: string
  readonly value: string
}

export interface Message {
  readonly subject: string
  readonly trailers: readonly Trailer[]
}

/** The message in `file` as git records it, or undefined when it cannot be read. */
export function readMessage(file: string): Message | undefined {
  let text: string

  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }

  const scissors = SCISSORS.exec(text)
  const stripped = git(['stripspace', '--strip-comments'], text.slice(0, scissors?.index))

  if (stripped.status !== 0) {
    return undefined
  }

  const parsed = git(['interpret-trailers', '--parse'], stripped.out)

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

  return { subject: stripped.out.split('\n', 1)[0] ?? '', trailers }
}
