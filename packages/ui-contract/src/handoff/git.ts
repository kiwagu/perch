/** Reads a git repository: the one call every reader of a ref shares. */

import { execFileSync } from 'node:child_process'

/** The output of `git <args>` run in the repository at `root`; a failing call throws. */
export const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
