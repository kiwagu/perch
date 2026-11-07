import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  author,
  commit,
  feed,
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

/** The tree with nothing in it, which every commit object made here is on. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Who made every commit object made here, and when. */
const IDENTITY = 't <t@example.test> 1700000000 +0000'

/** Two commit objects git cannot tell apart by their first seven hex digits, and those digits. */
interface Collision {
  readonly prefix: string
  readonly bodies: readonly [string, string]
}

/** The collision found, once a test asks for one. */
let collision: Collision | undefined

/** The commit object on the empty tree, by `t` at one fixed time, whose message is `x <n>`. */
function commitObject(n: number): string {
  return `tree ${EMPTY_TREE}\nauthor ${IDENTITY}\ncommitter ${IDENTITY}\n\nx ${n}\n`
}

/** The id git gives `body` as a commit object: the SHA-1 of `commit <its bytes>\0<body>`. */
function idOf(body: string): string {
  const bytes = new TextEncoder().encode(body)

  return createHash('sha1').update(`commit ${bytes.length}\0`).update(bytes).digest('hex')
}

/**
 * The first two of `commitObject`'s objects, counted from 0, that share their first seven hex
 * digits: hashed here, not written, until a pair is found, once, when the first test asks.
 */
function colliding(): Collision {
  if (collision !== undefined) {
    return collision
  }

  const seen = new Map<string, string>()

  for (let n = 0; ; n += 1) {
    const body = commitObject(n)
    const prefix = idOf(body).slice(0, 7)
    const earlier = seen.get(prefix)

    if (earlier !== undefined) {
      collision = { prefix, bodies: [earlier, body] }

      return collision
    }

    seen.set(prefix, body)
  }
}

/** Writes `body` into `root`'s objects as one of `type`, and returns its id. */
function stored(root: string, type: 'tree' | 'blob' | 'commit', body: string): string {
  return feed(root, body, 'hash-object', '-w', '-t', type, '--stdin')
}

/** Commits on `main`, without content, a landing of `feat/old` whose trailer names `tip`. */
function landedTip(root: string, tip: string): void {
  git(root, 'switch', '-q', 'main')
  author(
    root,
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'feat(web): land the page',
    '-m',
    `Squashed-from: feat/old (${tip}) ABC-1`,
  )
  git(root, 'switch', '-q', 'feat/me')
}

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

  it('refuses an earlier landing naming a commit git cannot tell from another', () => {
    const { root } = trunk()
    const { prefix, bodies } = colliding()

    stored(root, 'tree', '')

    for (const body of bodies) {
      stored(root, 'commit', body)
    }

    landedTip(root, prefix)
    code(root, 'shown')

    const result = runRound(root)

    refuses(
      result,
      `contract take: on feat/me, an earlier landing names ${prefix}, which git cannot tell from another commit.\n`,
    )
    expect(result.stdout).toBe('')
  })

  it('judges again what sits under an earlier tip the clone has as no commit', () => {
    const { root } = trunk()
    const blob = stored(root, 'blob', 'no commit\n')

    landedTip(root, blob)

    const raw = oldForm(root)

    refuses(
      runRound(root),
      `\n- ${raw} feat(screens): model the page\n`,
      `\nAn earlier landing names ${blob}, which this clone lacks: commits under it are judged again; fetch the branch that landed them if one of these is among them.\n`,
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

  it("judges an absent engine's branch as unknown", () => {
    const result = runRound(trunk().root, 'feat/contract-first-pass')

    refuses(result, 'contract take: git knows no branch feat/contract-first-pass in this clone.\n')
    expect(result.stdout).toBe('')
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
    expect(lookupOf(`${'0123456789abcdef'.repeat(2)}01234567 blob 10`)).toBe('missing')
    expect(lookupOf('abc1234 ambiguous')).toBe('ambiguous')
  })

  it('knows the branches that never land', () => {
    expect(NEVER_LANDS('contract/trunk')).toBe(true)
    expect(NEVER_LANDS('experiment/x')).toBe(true)
    expect(NEVER_LANDS('feat/me')).toBe(false)
  })
})
