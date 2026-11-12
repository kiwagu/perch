/**
 * A commit as git recorded it, read for the take check of a branch's round: its message, with the
 * trailers git reads in it, no cleanup applied, since git applied it when it recorded the message;
 * and the files it changes against its parent, or the empty tree for a root commit.
 */

import { git } from '../staged-commit.ts'

import { type Message, readingOf } from './message.ts'

/**
 * The message git recorded for `commit`, read with the repository's own comment setting as git's
 * `%(trailers)` reads it, without the check of its signature that `log.showSignature` prints above
 * it, or undefined when git cannot read it or its trailers.
 */
export function recordedMessage(commit: string): Message | undefined {
  const logged = git(['log', '-1', '--no-show-signature', '--format=%B', commit])

  if (logged.status !== 0) {
    return undefined
  }

  const reading = readingOf(logged.out)

  return reading === undefined ? undefined : { ...reading, doubt: undefined }
}

/**
 * The files `commit` changes, against its parent or the empty tree for a root commit, a move as
 * both its paths and a submodule even where the configuration ignores it, or undefined when git
 * cannot list them.
 */
export function recordedFiles(commit: string): readonly string[] | undefined {
  const { status, out } = git([
    'diff-tree',
    '--no-commit-id',
    '--root',
    '-r',
    '--name-only',
    '--no-renames',
    '--ignore-submodules=none',
    '-z',
    commit,
  ])

  return status === 0 ? out.split('\0').filter((file) => file !== '') : undefined
}
