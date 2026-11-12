/**
 * The options of the `git commit` that runs the commit-msg hook, as far as the take check reads
 * them: read from that command's arguments in /proc and parsed as `git commit` parses them (a
 * value apart from its option, bundled short options, abbreviated long ones, `--`). Where /proc
 * shows no git command running in this repository, there are none to read.
 */

import { readFileSync, realpathSync } from 'node:fs'
import { basename, sep } from 'node:path'

/** How far up its process tree the hook looks for the git command that runs it. */
const ANCESTORS = 16

/** git's own options, before its command, that take the next argument as their value. */
const GLOBAL_VALUED = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix',
  '--attr-source',
])

/** `git commit`'s long options that take a value, as git 2.53 lists them (`--git-completion-helper-all`). */
const VALUED = new Set([
  'file',
  'author',
  'date',
  'message',
  'reedit-message',
  'reuse-message',
  'fixup',
  'squash',
  'trailer',
  'template',
  'cleanup',
  'unified',
  'inter-hunk-context',
  'pathspec-from-file',
])

/** Its long options that take none, or one attached with `=` only. */
const BARE = [
  'quiet',
  'verbose',
  'reset-author',
  'signoff',
  'edit',
  'status',
  'gpg-sign',
  'all',
  'include',
  'interactive',
  'patch',
  'only',
  'no-verify',
  'dry-run',
  'short',
  'branch',
  'ahead-behind',
  'porcelain',
  'long',
  'null',
  'amend',
  'no-post-rewrite',
  'untracked-files',
  'pathspec-file-nul',
  'allow-empty',
  'allow-empty-message',
  'verify',
  'post-rewrite',
]

/** Every long option of `git commit`, each with its negation. */
const LONG = [...VALUED, ...BARE].flatMap((name) =>
  name.startsWith('no-') ? [name] : [name, `no-${name}`],
)

/** Its short options that take a value, the rest of their argument or the next one. */
const SHORT_VALUED = new Map([
  ['F', 'file'],
  ['m', 'message'],
  ['c', 'reedit-message'],
  ['C', 'reuse-message'],
  ['t', 'template'],
  ['U', 'unified'],
])

/** Its short options whose value, if any, is the rest of their argument. */
const SHORT_ATTACHED = new Set(['S', 'u'])

/** Its short options the check reads, by the long option each stands for. */
const SHORT_BARE = new Map([
  ['v', 'verbose'],
  ['e', 'edit'],
])

/** What the options of one `git commit` say, as far as the check reads them. */
export interface Options {
  amend: boolean
  verbose: number | undefined
  cleanup: string | undefined
  edit: boolean | undefined
  /** Whether the message is given (`-m`, `-F`, `-C`, a plain `--fixup`), so no editor opens unless asked. */
  given: boolean
}

/** The parent of process `pid`, read from /proc, or undefined. */
function parentOf(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])

    return Number.isSafeInteger(parent) && parent > 1 ? parent : undefined
  } catch {
    return undefined
  }
}

/**
 * The arguments of the nearest git process above this one, or undefined where /proc shows none, or
 * one working elsewhere than this repository (the hook runs at its top).
 */
function gitArguments(): readonly string[] | undefined {
  let pid: number | undefined = process.ppid

  try {
    const top = realpathSync(process.cwd())

    for (let level = 0; pid !== undefined && level < ANCESTORS; level += 1) {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')

      if (basename(argv[0] ?? '') === 'git') {
        const cwd = realpathSync(`/proc/${pid}/cwd`)

        return cwd === top || cwd.startsWith(top + sep) ? argv.slice(1, -1) : undefined
      }

      pid = parentOf(pid)
    }
  } catch {
    return undefined
  }

  return undefined
}

/** The long option `name` stands for, as git resolves an abbreviation, or undefined. */
function longOption(name: string): string | undefined {
  if (LONG.includes(name)) {
    return name
  }

  const matches = LONG.filter((option) => option.startsWith(name))

  return matches.length === 1 ? matches[0] : undefined
}

/** Records what option `name`, with `value`, says. */
function apply(options: Options, name: string | undefined, value: string | undefined): void {
  switch (name) {
    case 'amend':
    case 'no-amend':
      options.amend = name === 'amend'
      break
    case 'verbose':
      options.verbose = (options.verbose ?? 0) + 1
      break
    case 'no-verbose':
      options.verbose = 0
      break
    case 'edit':
    case 'no-edit':
      options.edit = name === 'edit'
      break
    case 'cleanup':
    case 'no-cleanup':
      options.cleanup = value
      break
    case 'message':
    case 'file':
    case 'reuse-message':
      options.given = true
      break
    case 'fixup':
      options.given ||= !/^(amend|reword):/.test(value ?? '')
      break
    default:
  }
}

/** Reads one short-option argument (`-am`, `-mtext`) from `at`, and where the next one starts. */
function short(options: Options, args: readonly string[], at: number): number {
  const arg = args[at] ?? ''

  for (let letter = 1; letter < arg.length; letter += 1) {
    const char = arg[letter] ?? ''
    const valued = SHORT_VALUED.get(char)

    if (valued !== undefined) {
      const attached = letter + 1 < arg.length

      apply(options, valued, attached ? arg.slice(letter + 1) : args[at + 1])

      return attached ? at + 1 : at + 2
    }

    if (SHORT_ATTACHED.has(char)) {
      break
    }

    apply(options, SHORT_BARE.get(char), undefined)
  }

  return at + 1
}

/** What a `git commit` command line (git's own arguments first) says, or undefined for another command. */
function optionsOf(args: readonly string[]): Options | undefined {
  let at = 0

  while (at < args.length && (args[at] ?? '').startsWith('-')) {
    at += GLOBAL_VALUED.has(args[at] ?? '') ? 2 : 1
  }

  if (args[at] !== 'commit') {
    return undefined
  }

  const options: Options = {
    amend: false,
    verbose: undefined,
    cleanup: undefined,
    edit: undefined,
    given: false,
  }

  at += 1

  while (at < args.length && args[at] !== '--') {
    const arg = args[at] ?? ''

    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=')
      const name = longOption(arg.slice(2, equals < 0 ? undefined : equals))
      const separate = equals < 0 && name !== undefined && VALUED.has(name)

      apply(options, name, separate ? args[at + 1] : equals < 0 ? undefined : arg.slice(equals + 1))
      at += separate ? 2 : 1
    } else if (arg.startsWith('-') && arg !== '-') {
      at = short(options, args, at)
    } else {
      at += 1
    }
  }

  return options
}

/** The options of the `git commit` running the hook, or undefined where /proc shows none. */
export function commitOptions(): Options | undefined {
  const args = gitArguments()

  return args === undefined ? undefined : optionsOf(args)
}
