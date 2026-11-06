import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTRACT_TAKE = fileURLToPath(new URL('./contract-take.ts', import.meta.url))

/**
 * The environment of every process here: without what a git hook would pass on, the marker the
 * merge hook sets, or the machine's own git configuration and hooks.
 */
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GIT_') && name !== 'CONTRACT_AHEAD_MERGE',
    ),
  ),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

const SCREEN = 'contract/domain/screens/me.yaml'
const SCENARIO = 'tests/e2e/scenarios/user/base/me.md'
const VOCABULARY = 'contract/vocabulary.md'

/** The checkouts the tests made, removed after each test. */
const made: string[] = []

/** Runs git in `cwd` without signing commits, and returns what it printed. */
function git(cwd: string, ...args: string[]): string {
  const run = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: ENV,
  })

  expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)

  return run.stdout.trim()
}

/** Runs git in `root` as an author, for a command that makes a commit. */
function author(root: string, ...args: string[]): string {
  return git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args)
}

/** Writes `file` in `root`, its folders included, and stages it. */
function stage(root: string, file: string, text = 'changed'): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), `${text}\n`)
  git(root, 'add', '--', file)
}

/** Commits what `root` stages as `subject`, unchecked, and returns the commit's short id. */
function commit(root: string, subject: string): string {
  author(root, 'commit', '-q', '-m', subject)

  return git(root, 'rev-parse', '--short', 'HEAD')
}

/** The commits of a contract trunk: three business commits of its own, oldest first. */
interface Trunk {
  readonly root: string
  readonly screen: string
  readonly scenario: string
  readonly vocabulary: string
}

/**
 * A checkout whose `main` holds the business layer's files, whose `contract/trunk` changes each
 * of them in a commit of its own, and whose area branch `feat/me`, cut from `main`, is checked out.
 */
function trunk(): Trunk {
  const root = mkdtempSync(join(tmpdir(), 'contract-take-'))

  made.push(root)
  git(root, 'init', '-q', '-b', 'main')

  for (const file of [SCREEN, SCENARIO, VOCABULARY, 'apps/web/src/main.tsx']) {
    stage(root, file, 'start')
  }

  commit(root, 'start')
  git(root, 'switch', '-q', '-c', 'contract/trunk')
  stage(root, SCREEN, 'modelled')

  const screen = commit(root, 'feat(screens): model the page')

  stage(root, SCENARIO, 'walked')

  const scenario = commit(root, 'test(scenarios): walk the page')

  stage(root, VOCABULARY, 'worded')

  const vocabulary = commit(root, 'feat(screens): name its codes')

  git(root, 'switch', '-q', '-c', 'feat/me', 'main')

  return { root, screen, scenario, vocabulary }
}

/** Runs the script in `root` as the commit-msg hook does, on `message`, with `env` on top. */
function run(
  root: string,
  message: string,
  env: Readonly<Record<string, string>> = {},
): SpawnSyncReturns<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'contract-take-message-')), 'COMMIT_EDITMSG')

  made.push(dirname(file))
  writeFileSync(file, message)

  return spawnSync(process.execPath, [CONTRACT_TAKE, file], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...ENV, ...env },
  })
}

/** A take's message: `subject`, then each of `trailers` in a paragraph of its own. */
function message(subject: string, ...trailers: string[]): string {
  return [subject, ...trailers.map((trailer) => `\n${trailer}`)].join('\n').concat('\n')
}

/** Picks `commits` without committing, as a take does. */
function pick(root: string, ...commits: string[]): void {
  author(root, 'cherry-pick', '--no-commit', ...commits)
}

/** What a passing check prints and answers. */
function passes(result: SpawnSyncReturns<string>): void {
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
}

/** What a refusing check answers, its message holding each of `parts`. */
function refuses(result: SpawnSyncReturns<string>, ...parts: string[]): void {
  expect(result.status).toBe(1)

  for (const part of parts) {
    expect(result.stderr).toContain(part)
  }
}

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('contract-take on an area branch', () => {
  it('lets a commit through that changes no business file and names no contract scope', () => {
    const { root } = trunk()

    stage(root, 'apps/web/src/main.tsx')
    stage(root, 'contract/COVERAGE.md')

    passes(run(root, message('feat(web): show the page')))
  })

  it('refuses a business change without the contract scope, naming its files', () => {
    const { root } = trunk()

    stage(root, SCREEN)

    refuses(
      run(root, message('feat(screens): model the page')),
      `\n  ${SCREEN}\n`,
      'comes from contract/trunk as a take, and this commit changes it',
    )
  })

  it('refuses a business change mixed with any other file, whatever its scope', () => {
    const { root, screen } = trunk()

    pick(root, screen)
    stage(root, 'apps/web/src/main.tsx')

    refuses(run(root, message('feat(web): show the page')), `\n  ${SCREEN}\n`)
    refuses(
      run(
        root,
        message('feat(contract): model the page', `Taken-from: contract/trunk ${screen} ABC-1`),
      ),
      'outside the business layer (contract/domain/, contract/vocabulary.md, tests/e2e/scenarios/), which go in a commit of their own under another scope (feat(web), docs(coverage), ...):\n  apps/web/src/main.tsx\n',
    )
  })

  it('refuses a contract-scoped commit of anything but the business layer, naming those files', () => {
    const { root } = trunk()

    stage(root, 'contract/COVERAGE.md')

    refuses(
      run(root, message('docs(contract): bring the coverage report up to date')),
      'under another scope (feat(web), docs(coverage), ...):\n  contract/COVERAGE.md\n',
    )
  })

  it("takes a card's trunk commits as one commit that names them by a run", () => {
    const { root, screen, scenario } = trunk()

    pick(root, screen, scenario)

    passes(
      run(
        root,
        message(
          'feat(contract): model the page',
          `Taken-from: contract/trunk ${screen}^..${scenario} ABC-1`,
        ),
      ),
    )
  })

  it("takes single commits around another card's, for one card or several", () => {
    const { root, screen, vocabulary } = trunk()

    pick(root, screen, vocabulary)

    passes(
      run(
        root,
        message(
          'feat(contract): model the page and its codes',
          `Taken-from: contract/trunk ${screen} ${vocabulary} ABC-1 ABC-2`,
        ),
      ),
    )
  })

  it('refuses a take that names no source, or names it twice', () => {
    const { root, screen } = trunk()
    const taken = `Taken-from: contract/trunk ${screen} ABC-1`

    pick(root, screen)

    refuses(run(root, message('feat(contract): model the page')), 'names its source in no trailer')
    refuses(
      run(root, message('feat(contract): model the page', `${taken}\n${taken}`)),
      'and it has 2',
    )
    refuses(
      run(root, message('feat(contract): model the page', `${taken}\nWritten-on-branch: ABC-1`)),
      'and it has 2',
    )
  })

  it('refuses a trailer git does not read as one, and a key in another case', () => {
    const { root, screen } = trunk()

    pick(root, screen)

    refuses(
      run(
        root,
        `feat(contract): model the page\n\nTaken from the trunk.\nTaken-from: contract/trunk ${screen} ABC-1\n`,
      ),
      'names its source in no trailer',
    )
    refuses(
      run(
        root,
        message('feat(contract): model the page', `taken-from: contract/trunk ${screen} ABC-1`),
      ),
      'not "taken-from:"',
    )
  })

  it('refuses a run written as git leaves its first commit out, and a trailer missing a part', () => {
    const { root, screen, scenario } = trunk()

    pick(root, screen, scenario)

    for (const trailer of [
      `Taken-from: contract/trunk ${screen}..${scenario} ABC-1`,
      `Taken-from: contract/trunk ${screen}^..${scenario}`,
      `Taken-from: contract/trunk ABC-1`,
      `Taken-from: ${screen}^..${scenario} ABC-1`,
    ]) {
      refuses(run(root, message('feat(contract): model the page', trailer)), `"${trailer}" is not.`)
    }
  })

  it("refuses a named commit off the trunk's own line, and one git does not know", () => {
    const { root, screen } = trunk()
    const start = git(root, 'rev-parse', '--short', 'main')

    stage(root, 'apps/web/src/main.tsx', 'area')

    const area = commit(root, 'feat(web): show the page')

    pick(root, screen)

    for (const named of [start, area, 'abcdef1']) {
      refuses(
        run(
          root,
          message('feat(contract): model the page', `Taken-from: contract/trunk ${named} ABC-1`),
        ),
        named,
      )
    }
  })

  it('refuses a run whose first comes after its last, and commits named out of order', () => {
    const { root, screen, scenario, vocabulary } = trunk()

    pick(root, screen, scenario)

    refuses(
      run(
        root,
        message(
          'feat(contract): model the page',
          `Taken-from: contract/trunk ${scenario}^..${screen} ABC-1`,
        ),
      ),
      `the run ${scenario}^..${screen} starts after it ends`,
    )
    author(root, 'reset', '-q', '--hard', 'HEAD')
    pick(root, screen, vocabulary)
    refuses(
      run(
        root,
        message(
          'feat(contract): model the page',
          `Taken-from: contract/trunk ${vocabulary} ${screen} ABC-1`,
        ),
      ),
      `${screen} does not come after ${vocabulary}`,
    )
    refuses(
      run(
        root,
        message(
          'feat(contract): model the page',
          `Taken-from: contract/trunk ${screen} ${screen}^..${vocabulary} ABC-1`,
        ),
      ),
      `${screen}^..${vocabulary} does not come after ${screen}`,
    )
  })

  it('refuses a take that stages a file none of its commits change, naming it', () => {
    const { root, screen } = trunk()

    pick(root, screen)
    stage(root, SCENARIO, 'edited on the area branch')

    refuses(
      run(
        root,
        message('feat(contract): model the page', `Taken-from: contract/trunk ${screen} ABC-1`),
      ),
      `taken as one more commit:\n  ${SCENARIO}\n`,
    )
  })

  it('lets a take through whose conflict was resolved in a file its commit changes', () => {
    const { root, screen } = trunk()

    stage(root, SCREEN, 'written on the area branch before the trunk')
    commit(root, 'feat(contract): model the page here')

    const picked = spawnSync('git', ['cherry-pick', '--no-commit', screen], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      env: ENV,
    })

    expect(picked.status).not.toBe(0)
    stage(root, SCREEN, 'resolved')

    passes(
      run(
        root,
        message('feat(contract): model the page', `Taken-from: contract/trunk ${screen} ABC-1`),
      ),
    )
  })

  it('lets a business commit through that the rules allow on the branch, naming its cards', () => {
    const { root } = trunk()

    stage(root, SCREEN, 'old names dropped')

    passes(
      run(
        root,
        message('refactor(contract): drop the old names', 'Written-on-branch: ABC-1 ABC-2'),
      ),
    )
    refuses(
      run(root, message('refactor(contract): drop the old names', 'Written-on-branch: the card')),
      'naming each card: "Written-on-branch: the card" is not.',
    )
  })

  it('refuses a source trailer under a subject without the contract scope', () => {
    const { root, screen } = trunk()

    pick(root, screen)

    refuses(
      run(
        root,
        message('feat(screens): model the page', `Taken-from: contract/trunk ${screen} ABC-1`),
      ),
      '"feat(screens): model the page" is not.',
    )
  })

  it('refuses a subject that names the contract scope another way', () => {
    const { root, screen } = trunk()
    const taken = `Taken-from: contract/trunk ${screen} ABC-1`

    pick(root, screen)

    for (const subject of [
      'Feat(contract): model the page',
      'feat(contract,screens): model the page',
      'feat(contract)!: model the page',
      '(contract): model the page',
    ]) {
      refuses(run(root, message(subject, taken)), `"${subject}" is not.`)
    }
  })

  it('judges a commit that stages nothing by its message alone, as an amend of the message', () => {
    const { root, screen } = trunk()

    passes(
      run(
        root,
        message('feat(contract): model the page', `Taken-from: contract/trunk ${screen} ABC-1`),
      ),
    )
    refuses(run(root, message('feat(contract): model the page')), 'names its source in no trailer')
  })

  it('reads the trunk from origin when the clone has no branch of its own', () => {
    const { root, screen } = trunk()

    git(root, 'update-ref', 'refs/remotes/origin/contract/trunk', 'contract/trunk')
    git(root, 'branch', '-q', '-D', 'contract/trunk')
    pick(root, screen)

    passes(
      run(
        root,
        message('feat(contract): model the page', `Taken-from: contract/trunk ${screen} ABC-1`),
      ),
    )
  })

  it('refuses a take when the clone knows no trunk, saying how to get it', () => {
    const { root, screen } = trunk()

    pick(root, screen)
    git(root, 'branch', '-q', '-D', 'contract/trunk')

    refuses(
      run(
        root,
        message('feat(contract): model the page', `Taken-from: contract/trunk ${screen} ABC-1`),
      ),
      'git fetch origin contract/trunk',
    )
  })

  it('reads a message the editor left, its comments and what follows the scissors aside', () => {
    const { root, screen } = trunk()

    pick(root, screen)

    passes(
      run(
        root,
        [
          'feat(contract): model the page',
          '',
          `Taken-from: contract/trunk ${screen} ABC-1`,
          '# Please enter the commit message for your changes.',
          '# ------------------------ >8 ------------------------',
          'diff --git a/x b/x',
          'Taken-from: contract/trunk abcdef1 ABC-9',
          '',
        ].join('\n'),
      ),
    )
  })
})

describe('contract-take elsewhere', () => {
  it('lets a business commit through on main, the trunk, the engine branch and an experiment', () => {
    const { root } = trunk()

    for (const branch of ['main', 'contract/trunk', 'feat/contract-first-pass', 'experiment/me']) {
      git(root, 'switch', '-q', '-C', branch)
      stage(root, SCREEN, branch)

      passes(run(root, message('feat(screens): model the page')))
    }
  })

  it('lets a commit through on a detached HEAD and while a merge waits for its commit', () => {
    const { root } = trunk()

    author(root, 'merge', '-q', '--no-commit', '--no-ff', 'contract/trunk')

    passes(run(root, message('chore: merge the trunk')))

    author(root, 'merge', '--abort')
    git(root, 'switch', '-q', '--detach', 'HEAD')
    stage(root, SCREEN)

    passes(run(root, message('feat(screens): model the page')))
  })

  it('refuses a commit when git cannot tell the branch it is on', () => {
    const { root } = trunk()

    refuses(
      run(root, message('feat(web): show the page'), { GIT_DIR: join(root, 'missing') }),
      'contract take: git cannot tell the branch this commit is on',
    )
  })
})
