/**
 * The turbo run of a task for every workspace except the excluded ones: `--exclude a,b`,
 * `--exclude=a` and `-x c` name workspace packages to leave out, everything after `--` goes to
 * turbo as is, and any other argument goes to turbo too.
 *
 *   bun run dev --exclude @workspace/web
 *   bun run dev -x @workspace/gateway -- --log-order=grouped
 */

const splitNames = (value: string): string[] =>
  value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

/** The excluded workspaces, and turbo's arguments for running `task` without them. */
export function turboRun(
  task: string,
  argv: readonly string[],
): { excludes: string[]; args: string[] } {
  const excludes: string[] = []
  const rest: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''

    if (arg === '--') {
      rest.push(...argv.slice(index + 1))

      break
    }

    if (arg === '--exclude' || arg === '-x') {
      excludes.push(...splitNames(argv[++index] ?? ''))
    } else if (arg.startsWith('--exclude=')) {
      excludes.push(...splitNames(arg.slice('--exclude='.length)))
    } else {
      rest.push(arg)
    }
  }

  return { excludes, args: ['run', task, ...excludes.map((name) => `--filter=!${name}`), ...rest] }
}
