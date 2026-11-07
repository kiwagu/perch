import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test'

import {
  author,
  commit,
  git,
  land,
  passes,
  pick,
  refuses,
  removeMade,
  runRound,
  SCREEN,
  stage,
  type Trunk,
  trunk,
} from './takes/__fixtures__/repo.ts'
import { FORM, lookupOf, NEVER_LANDS, parseSquashed } from './takes/index.ts'

/**
 * Each case runs git a dozen times or more, and the check itself over a branch: under the
 * pre-commit hook's suites running side by side, one takes seconds.
 */
setDefaultTimeout(30_000)

afterEach(removeMade)

const NEW_SCREEN = 'contract/domain/screens/new.yaml'

/** Takes the trunk's three commits on the checked-out branch, unchecked, and returns the take's short id. */
function take({ root, screen, scenario, vocabulary }: Trunk): string {
  pick(root, screen, scenario, vocabulary)
  author(
    root,
    'commit',
    '-q',
    '-m',
    'feat(contract): model the page',
    '-m',
    `Taken-from: contract/trunk ${screen}^..${vocabulary} ABC-1`,
  )

  return git(root, 'rev-parse', '--short', 'HEAD')
}

/** Commits a change of `text` to the web app on the checked-out branch, and returns its short id. */
function code(root: string, text: string): string {
  stage(root, 'apps/web/src/main.tsx', text)

  return commit(root, 'feat(web): show the page')
}

/** Commits a change of the screen without the contract scope, the old form, and returns its short id. */
function oldForm(root: string, text = 'raw'): string {
  stage(root, SCREEN, text)

  return commit(root, 'feat(screens): model the page')
}

/** Merges `branch` into the checked-out one with a merge commit, as a branch brings `main` in. */
function merge(root: string, branch: string, ...args: string[]): void {
  author(root, 'merge', '-q', '--no-ff', ...args, '-m', `chore: merge ${branch}`, branch)
}

/** Starts an orphan branch `branch` whose one commit adds the new screen under `subject` and `trailers`. */
function orphan(root: string, branch: string, subject: string, ...trailers: string[]): string {
  git(root, 'switch', '-q', '--orphan', branch)
  stage(root, NEW_SCREEN, 'new')
  author(root, 'commit', '-q', '-m', subject, ...trailers.flatMap((trailer) => ['-m', trailer]))

  return git(root, 'rev-parse', '--short', 'HEAD')
}

describe('contract-take --round', () => {
  it('judges every commit since main on a branch that never landed', () => {
    const fixture = trunk()

    take(fixture)
    code(fixture.root, 'shown')

    const result = runRound(fixture.root)

    passes(result)
    expect(result.stdout).toBe(
      'contract take: every commit of feat/me since its last landing (2) is in its form\n',
    )
  })

  it("names each commit of the round that is not in a take's form, and no other", () => {
    const fixture = trunk()
    const { root } = fixture
    const taken = take(fixture)
    const shown = code(root, 'shown')
    const raw = oldForm(root)

    stage(root, SCREEN, 'mixed')
    stage(root, 'apps/web/src/main.tsx', 'mixed')

    const mixed = commit(root, 'feat(contract): show the page')
    const result = runRound(root)

    refuses(
      result,
      `contract take: feat/me (${mixed}) carries commits that are not in a take's form:\n`,
      `\n- ${raw} feat(screens): model the page\n`,
      `comes from contract/trunk as a take, and this commit changes it:\n    ${SCREEN}\n`,
      `\n- ${mixed} feat(contract): show the page\n`,
      `outside the business layer`,
      "\nRewrite them on feat/me before landing (a message: reword it; a commit that mixes the business layer with other files: split it); a branch that was pushed is rewritten only on the developer's word.\n",
      FORM,
    )
    expect(result.stderr).not.toContain(taken)
    expect(result.stderr).not.toContain(shown)
    expect(result.stdout).toBe('')
  })

  it('leaves out what an earlier landing carried', () => {
    const { root } = trunk()

    oldForm(root)
    land(root, 'feat/me')
    merge(root, 'main')
    code(root, 'shown')

    const result = runRound(root)

    passes(result)
    expect(result.stdout).toEndWith('(1) is in its form\n')
  })

  it('leaves out what a branch landed under another name', () => {
    const { root } = trunk()

    git(root, 'switch', '-q', '-c', 'feat/old')
    oldForm(root)
    land(root, 'feat/old')
    git(root, 'switch', '-q', '-c', 'feat/new')
    merge(root, 'main')
    code(root, 'shown')
    git(root, 'switch', '-q', 'feat/me')

    const result = runRound(root, 'feat/new')

    passes(result)
    expect(result.stdout).toBe(
      'contract take: every commit of feat/new since its last landing (1) is in its form\n',
    )
  })

  it('counts a commit two landings name by different short ids once', () => {
    const { root } = trunk()

    oldForm(root)

    const longer = git(root, 'rev-parse', '--short=9', 'feat/me')

    land(root, 'feat/me')
    git(root, 'switch', '-q', 'main')
    author(
      root,
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'feat(web): land the page again',
      '-m',
      `Squashed-from: feat/me (${longer}) ABC-1`,
    )
    git(root, 'switch', '-q', 'feat/me')
    code(root, 'shown')

    const result = runRound(root)

    passes(result)
    expect(result.stdout).toEndWith('(1) is in its form\n')
  })

  it('judges again what sits under an earlier tip the clone lacks, and says so', () => {
    const { root } = trunk()

    git(root, 'switch', '-q', '-c', 'feat/old')

    const raw = oldForm(root)

    git(root, 'switch', '-q', '-c', 'feat/new')
    git(root, 'switch', '-q', 'feat/old')
    code(root, 'shown')

    const tip = git(root, 'rev-parse', '--short', 'feat/old')

    land(root, 'feat/old')
    git(root, 'switch', '-q', 'feat/new')
    git(root, 'branch', '-q', '-D', 'feat/old')
    git(root, 'reflog', 'expire', '--expire=now', '--all')
    git(root, 'gc', '--prune=now', '-q')
    code(root, 'shown again')

    refuses(
      runRound(root),
      `\n- ${raw} feat(screens): model the page\n`,
      `\nAn earlier landing names ${tip}, which this clone lacks: commits under it are judged again; fetch the branch that landed them if one of these is among them.\n`,
    )
  })

  it('names together the earlier tips the clone lacks', () => {
    const { root } = trunk()

    git(root, 'switch', '-q', '-c', 'feat/old')
    oldForm(root)
    git(root, 'switch', '-q', '-c', 'feat/new')
    git(root, 'switch', '-q', 'feat/old')
    code(root, 'shown')

    const first = git(root, 'rev-parse', '--short', 'feat/old')

    land(root, 'feat/old')
    git(root, 'switch', '-q', '-c', 'feat/gone', 'main')
    code(root, 'shown again')

    const second = git(root, 'rev-parse', '--short', 'feat/gone')

    land(root, 'feat/gone', 'feat(web): land the page again')
    git(root, 'switch', '-q', 'feat/new')
    git(root, 'branch', '-q', '-D', 'feat/old', 'feat/gone')
    git(root, 'reflog', 'expire', '--expire=now', '--all')
    git(root, 'gc', '--prune=now', '-q')

    refuses(
      runRound(root),
      `\nEarlier landings name ${first} and ${second}, which this clone lacks: commits under them are judged again; fetch the branches that landed them if one of these is among them.\n`,
    )
  })

  it('reads a root commit of the round against the empty tree', () => {
    const written = trunk().root

    orphan(written, 'feat/new', 'feat(contract): model the new page', 'Written-on-branch: ABC-1')
    git(written, 'switch', '-q', 'feat/me')
    merge(written, 'feat/new', '--allow-unrelated-histories')

    const result = runRound(written)

    passes(result)
    expect(result.stdout).toEndWith('(1) is in its form\n')

    const unwritten = trunk().root
    const root = orphan(unwritten, 'feat/new', 'feat(screens): model the new page')

    git(unwritten, 'switch', '-q', 'feat/me')
    merge(unwritten, 'feat/new', '--allow-unrelated-histories')
    refuses(
      runRound(unwritten),
      `\n- ${root} feat(screens): model the new page\n`,
      `and this commit changes it:\n    ${NEW_SCREEN}\n`,
    )
  })

  it('leaves the index and HEAD as they were', () => {
    const { root } = trunk()

    oldForm(root)
    stage(root, 'apps/web/src/main.tsx', 'staged, not committed')

    const before = [git(root, 'write-tree'), git(root, 'rev-parse', 'HEAD')]

    refuses(runRound(root), "carries commits that are not in a take's form")
    expect([git(root, 'write-tree'), git(root, 'rev-parse', 'HEAD')]).toEqual(before)
  })

  it("does not judge the engine's branch", () => {
    const { root } = trunk()

    git(root, 'switch', '-q', '-c', 'feat/contract-first-pass')
    stage(root, 'scripts/takes/round.ts', 'engine')
    commit(root, 'feat(contract): judge the round')

    const result = runRound(root, 'feat/contract-first-pass')

    passes(result)
    expect(result.stdout).toBe(
      "contract take: feat/contract-first-pass is the contract engine's branch; its round is not judged\n",
    )
  })

  it('reads a landing trailer in its form, and refuses one that is not', () => {
    expect(parseSquashed('feat/me (abc1234) ABC-1 ABC-2')).toEqual({
      branch: 'feat/me',
      tip: 'abc1234',
      cards: ['ABC-1', 'ABC-2'],
    })
    expect(parseSquashed('feat/me (abc1234)')).toEqual({
      branch: 'feat/me',
      tip: 'abc1234',
      cards: [],
    })
    expect(parseSquashed('feat/me (abc1234)  ')).toEqual({
      branch: 'feat/me',
      tip: 'abc1234',
      cards: [],
    })

    for (const value of ['feat/me abc1234', 'feat/me (abc12)', 'feat/me (abc1234) abc-1']) {
      expect(parseSquashed(value), value).toBeUndefined()
    }
  })

  it('reads what git says of a name it looks up', () => {
    expect(lookupOf(`${'0123456789abcdef'.repeat(2)}01234567 commit 231`)).toBe('found')
    expect(lookupOf('deadbee missing')).toBe('missing')
    expect(lookupOf('abc1234 ambiguous')).toBe('ambiguous')
  })

  it('knows the branches that never land', () => {
    expect(NEVER_LANDS('contract/trunk')).toBe(true)
    expect(NEVER_LANDS('experiment/x')).toBe(true)
    expect(NEVER_LANDS('feat/me')).toBe(false)
  })
})
