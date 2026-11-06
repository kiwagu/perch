/**
 * A commit message as git records it, read for the take check: its subject and its trailers, what
 * `git commit --verbose` shows below its scissors line left out. Git strips comment lines or keeps
 * them by its cleanup mode (it keeps them for a message given with `-m`), so the message is read
 * both ways, and whether the two agree is part of what the check judges.
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
  /** Whether the subject and the trailers are the same whether git strips comment lines or keeps them. */
  readonly alike: boolean
}

/** The subject and trailers of `text` cleaned up by git, its comment lines stripped or kept. */
function reading(
  text: string,
  stripComments: boolean,
): Pick<Message, 'subject' | 'trailers'> | undefined {
  const cleaned = git(['stripspace', ...(stripComments ? ['--strip-comments'] : [])], text)

  if (cleaned.status !== 0) {
    return undefined
  }

  const parsed = git(['interpret-trailers', '--parse'], cleaned.out)

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

  return { subject: cleaned.out.split('\n', 1)[0] ?? '', trailers }
}

/** The message in `file` as git records it, or undefined when it cannot be read. */
export function readMessage(file: string): Message | undefined {
  let text: string

  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }

  const kept = text.slice(0, SCISSORS.exec(text)?.index)
  const stripped = reading(kept, true)
  const whole = reading(kept, false)

  if (stripped === undefined || whole === undefined) {
    return undefined
  }

  const alike =
    stripped.subject === whole.subject &&
    JSON.stringify(stripped.trailers) === JSON.stringify(whole.trailers)

  return { ...stripped, alike }
}
