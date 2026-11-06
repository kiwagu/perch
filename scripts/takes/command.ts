/**
 * What the git command that runs the commit-msg hook will record, which git tells a hook nothing
 * of: whether the commit replaces HEAD (`--amend`), and how git cleans its message up (cut at the
 * scissors line, comment lines stripped or kept, or the message kept as written), from the
 * command's options (`arguments.ts`) and git's configuration. Where no `git commit` running in
 * this repository can be read (a system without /proc, or a commit another git command makes), the
 * commit is taken for no amend, the message is cut at a scissors line it holds, and its comment
 * lines must not change what it says.
 */

import { git } from '../staged-commit.ts'

import { commitOptions, type Options } from './arguments.ts'

/** How git cleans a message up: its comment lines stripped or kept, as written, or either of the first two. */
export type CleanupMode = 'strip' | 'whitespace' | 'verbatim' | 'either'

export interface Cleanup {
  /** Whether git cuts the message at its scissors line. */
  readonly cut: boolean
  readonly mode: CleanupMode
  /** What a comment line may start with. */
  readonly comments: readonly string[]
}

export interface CommitCommand {
  /** Whether the commit replaces HEAD. */
  readonly amend: boolean
  readonly cleanup: Cleanup
}

/** What git picks a comment character from when `core.commentChar` is `auto`. */
const AUTO_COMMENTS = [...'#;@!$%^&|:']

/** The value of git's configuration `key`, or undefined. */
function config(key: string, type?: string): string | undefined {
  const { status, out } = git(['config', ...(type === undefined ? [] : [`--type=${type}`]), key])

  return status === 0 ? out.trim() : undefined
}

/** What a comment line may start with, by `core.commentChar` (or `core.commentString`). */
function comments(): readonly string[] {
  const { status, out } = git(['config', '--get-regexp', '^core\\.comment(char|string)$'])
  const value =
    status === 0
      ? out
          .trim()
          .split('\n')
          .at(-1)
          ?.replace(/^\S+ ?/, '')
      : undefined

  if (value === undefined || value === '') {
    return ['#']
  }

  return value === 'auto' ? AUTO_COMMENTS : [value]
}

/** How verbose `commit.verbose` makes a commit: 0 for not at all. */
function configuredVerbose(): number {
  const value = config('commit.verbose', 'bool-or-int')

  return value === 'true' ? 1 : Number(value ?? 0) || 0
}

/**
 * How git cleans the message of a commit made with `options` up, or of one an unknown command
 * makes. git cuts at the scissors line under `--verbose`, or in the scissors mode when an editor
 * opens; its default mode strips comment lines when an editor opens and keeps them otherwise, so
 * there the message must say the same either way.
 */
function cleanupOf(options: Options | undefined): Cleanup {
  const mode = options?.cleanup ?? config('commit.cleanup') ?? 'default'
  const editor = options?.edit ?? !options?.given
  const verbose = options?.verbose ?? configuredVerbose()
  const cut = options === undefined || verbose > 0 || (mode === 'scissors' && editor)
  const comment = comments()

  switch (mode) {
    case 'verbatim':
    case 'strip':
      return { cut, mode, comments: comment }
    case 'whitespace':
    case 'scissors':
      return { cut, mode: 'whitespace', comments: comment }
    default:
      return { cut, mode: 'either', comments: comment }
  }
}

/** What the git command running the commit-msg hook will record. */
export function commitCommand(): CommitCommand {
  const options = commitOptions()

  return { amend: options?.amend ?? false, cleanup: cleanupOf(options) }
}
