import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  author,
  commit,
  commitThroughHook,
  feed,
  git,
  gitThroughHook,
  land,
  made,
  message,
  passes,
  pick,
  refuses,
  removeMade,
  run,
  runRound,
  SCREEN,
  stage,
  type Trunk,
  trunk,
} from './takes/__fixtures__/repo.ts'
import {
  FORM,
  lookupOf,
  NEVER_LANDS,
  parseSquashed,
  readingOf,
  SQUASH_FORM,
} from './takes/index.ts'

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

/** The line git cuts a message at when it cleans it up, under the default comment character. */
const SCISSORS = '# ------------------------ >8 ------------------------'

/** The trailer of a take of the trunk's three commits. */
function takenFrom({ screen, vocabulary }: Trunk): string {
  return `Taken-from: contract/trunk ${screen}^..${vocabulary} ABC-1`
}

/** Takes the trunk's three commits on the checked-out branch with `text` as the message, recorded as written. */
function recorded(fixture: Trunk, text: string): void {
  const { root, screen, scenario, vocabulary } = fixture
  const file = join(root, '.git', 'MESSAGE')

  pick(root, screen, scenario, vocabulary)
  writeFileSync(file, text)
  author(root, 'commit', '-q', '--cleanup=verbatim', '-F', file)
}

/**
 * Judges the round of the checked-out branch, whose tip is a take recorded as written, against
 * git's own reading of that commit: a take git reads with its trailer passes, one git reads
 * without it is refused as naming no source.
 */
function agreesWithGit(root: string): void {
  const read = git(root, 'log', '-1', '--format=%(trailers:key=Taken-from,valueonly)', 'HEAD')
  const result = runRound(root)

  if (read === '') {
    refuses(result, 'it names its source in no trailer')
  } else {
    passes(result)
  }
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

/** Stages on `main` the squash of `branch`, as the landing procedure does, and returns the branch's short tip. */
function squash(root: string, branch = 'feat/me'): string {
  const tip = git(root, 'rev-parse', '--short', branch)

  git(root, 'switch', '-q', 'main')
  author(root, 'merge', '-q', '--squash', branch)

  return tip
}

/** A round of a take and a code commit on `feat/me`, its squash staged on `main`; returns the branch's short tip. */
function staged(fixture: Trunk): string {
  take(fixture)
  code(fixture.root, 'shown')

  return squash(fixture.root)
}

/** The trailer of a landing of `branch` at `tip`. */
function squashedFrom(tip: string, branch = 'feat/me'): string {
  return `Squashed-from: ${branch} (${tip}) ABC-1`
}

/** Runs the check in `root` on a landing's message with `trailers`, as the hook does, without a git command above it. */
function landing(root: string, ...trailers: string[]): ReturnType<typeof run> {
  return run(root, message('feat(web): show the page', ...trailers))
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

  it('reads a comment line above a recorded trailer as git does', () => {
    const fixture = trunk()

    recorded(fixture, `feat(contract): model the page\n\n# note\n${takenFrom(fixture)}\n`)
    agreesWithGit(fixture.root)
  })

  it('reads what a recorded scissors line cuts as git does', () => {
    const below = trunk()

    recorded(
      below,
      `feat(contract): model the page\n\n${SCISSORS}\nkept after the scissors\n\n${takenFrom(below)}\n`,
    )
    agreesWithGit(below.root)

    const above = trunk()

    recorded(
      above,
      `feat(contract): model the page\n\n${takenFrom(above)}\n${SCISSORS}\nkept after the scissors\n`,
    )
    agreesWithGit(above.root)
  })

  it('reads a recorded message with CRLF line endings as git does', () => {
    const fixture = trunk()

    recorded(fixture, `feat(contract): model the page\r\n\r\n${takenFrom(fixture)}\r\n`)
    agreesWithGit(fixture.root)
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

  it("reads a message's subject and trailers as git does", () => {
    const text =
      '\nfeat(contract): model the page\n\n; a note\nTaken-from:  contract/trunk abc1234 ABC-1 \n'

    expect(readingOf(text, ';')).toEqual({
      subject: 'feat(contract): model the page',
      trailers: [{ key: 'Taken-from', value: 'contract/trunk abc1234 ABC-1' }],
    })
    expect(readingOf('feat(web): show the page\n\nno trailer here\n', ';')).toEqual({
      subject: 'feat(web): show the page',
      trailers: [],
    })
  })
})

describe('contract-take on main', () => {
  it('passes a squash made as the landing procedure makes it', () => {
    const fixture = trunk()
    const { root } = fixture
    const tip = staged(fixture)

    passes(commitThroughHook(root, '-m', 'feat(web): show the page', '-m', squashedFrom(tip)))
    expect(git(root, 'log', '-1', '--format=%(trailers:key=Squashed-from,valueonly)')).toBe(
      `feat/me (${tip}) ABC-1`,
    )
    expect(git(root, 'rev-parse', 'main^{tree}')).toBe(git(root, 'rev-parse', 'feat/me^{tree}'))
  })

  it('refuses a squash whose round holds a commit made past the hook', () => {
    const fixture = trunk()
    const { root } = fixture

    take(fixture)

    const raw = oldForm(root)
    const tip = squash(root)
    const before = git(root, 'rev-parse', 'main')

    refuses(
      commitThroughHook(root, '-m', 'feat(web): show the page', '-m', squashedFrom(tip)),
      `contract take: feat/me (${tip}) carries commits that are not in a take's form:\n- ${raw} feat(screens): model the page\n`,
      FORM,
    )
    expect(git(root, 'rev-parse', 'main')).toBe(before)
  })

  it('refuses a merge into main, clean or after a conflict', () => {
    const clean = trunk()

    code(clean.root, 'shown')
    git(clean.root, 'switch', '-q', 'main')

    const before = git(clean.root, 'rev-parse', 'main')

    refuses(
      gitThroughHook(clean.root, '', 'merge', '--no-ff', '-m', 'Merge feat/me', 'feat/me'),
      'main takes squashes only',
      SQUASH_FORM,
    )
    expect(git(clean.root, 'rev-parse', 'main')).toBe(before)

    const conflicted = trunk()
    const { root } = conflicted
    const tip = code(root, 'shown')

    git(root, 'switch', '-q', 'main')
    code(root, 'shown otherwise')
    expect(gitThroughHook(root, '', 'merge', '-q', 'feat/me').status).not.toBe(0)
    expect(git(root, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD')).not.toBe('')
    refuses(landing(root, squashedFrom(tip)), 'main takes squashes only', SQUASH_FORM)
  })

  it('refuses a landing without its trailer, with two, or with one out of form', () => {
    const fixture = trunk()
    const { root } = fixture
    const tip = staged(fixture)

    refuses(landing(root), 'names the branch it squashes in no trailer', SQUASH_FORM)
    refuses(
      landing(root, `${squashedFrom(tip)}\n${squashedFrom(tip)}`),
      'in one trailer, and this commit has 2',
    )
    refuses(
      landing(root, `Squashed-from: feat/me ${tip}`),
      `"Squashed-from: feat/me ${tip}" is not.`,
    )
    refuses(
      landing(root, `squashed-from: feat/me (${tip})`),
      'written "Squashed-from:", in that case, not "squashed-from:"',
    )
  })

  it('refuses a landing that names a branch or a tip git does not know, or a tip off its branch', () => {
    const fixture = trunk()
    const { root } = fixture

    git(root, 'switch', '-q', '-c', 'feat/other')

    const other = code(root, 'other')

    git(root, 'switch', '-q', 'feat/me')

    const tip = staged(fixture)

    refuses(landing(root, squashedFrom(tip, 'feat/gone')), 'git knows no branch feat/gone')
    refuses(landing(root, squashedFrom('deadbee')), 'git knows no commit deadbee')
    refuses(landing(root, squashedFrom(other)), `${other} is not on feat/me`)
  })

  it('refuses a landing that names its branch by a revision of it, and passes one by its name', () => {
    const fixture = trunk()
    const { root } = fixture
    const tip = staged(fixture)

    for (const branch of ['feat/me~0', 'feat/me^0', 'feat/me@{0}']) {
      refuses(
        landing(root, squashedFrom(tip, branch)),
        `contract take: this commit's trailer names ${branch}, and git knows no branch ${branch} in this clone.\n`,
        SQUASH_FORM,
      )
    }

    passes(landing(root, squashedFrom(tip)))
  })

  it('refuses a landing naming a tip git cannot tell from another commit', () => {
    const fixture = trunk()
    const { root } = fixture
    const { prefix, bodies } = colliding()

    stored(root, 'tree', '')

    for (const body of bodies) {
      stored(root, 'commit', body)
    }

    staged(fixture)

    const result = landing(root, squashedFrom(prefix))

    refuses(result, `names ${prefix}, which git cannot tell from another commit`)
    expect(result.stderr).not.toContain('knows no commit')
  })

  it("refuses a landing whose tree is not its tip's, or whose tip is not on top of main", () => {
    const older = trunk()
    const taken = take(older)

    code(older.root, 'shown')
    squash(older.root)
    refuses(landing(older.root, squashedFrom(taken)), `is not the tree of ${taken}`)

    const behind = trunk()
    const { root } = behind

    take(behind)
    code(root, 'shown')
    git(root, 'switch', '-q', 'main')

    const later = code(root, 'shown')

    const tip = squash(root)

    refuses(landing(root, squashedFrom(tip)), `main (${later}) is not under ${tip}`)
  })

  it('refuses a landing that changes nothing, as an amend made without /proc reads', () => {
    const fixture = trunk()
    const { root } = fixture

    take(fixture)
    code(root, 'shown')
    land(root, 'feat/me')
    merge(root, 'main')

    const back = git(root, 'rev-parse', '--short', 'feat/me')

    git(root, 'switch', '-q', 'main')
    refuses(landing(root, squashedFrom(back)), 'a landing changes main', SQUASH_FORM)
  })

  it('passes an amend of the squash read from its git command', () => {
    const fixture = trunk()
    const { root } = fixture
    const tip = staged(fixture)

    passes(commitThroughHook(root, '-m', 'feat(web): show the page', '-m', squashedFrom(tip)))
    passes(
      commitThroughHook(
        root,
        '--amend',
        '-m',
        'feat(web): show the page again',
        '-m',
        squashedFrom(tip),
      ),
    )
    expect(git(root, 'log', '-1', '--format=%s')).toBe('feat(web): show the page again')
    expect(git(root, 'rev-list', '--count', 'main')).toBe('2')
  })

  it('refuses a landing on an unborn main', () => {
    const root = mkdtempSync(join(tmpdir(), 'contract-take-'))

    made.push(root)
    git(root, 'init', '-q', '-b', 'feat/me')

    const tip = code(root, 'shown')

    git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    refuses(landing(root, squashedFrom(tip)), 'main has no commit', SQUASH_FORM)
  })

  it("passes the engine's branch unjudged, refuses the trunk and an experiment", () => {
    const { root } = trunk()

    git(root, 'switch', '-q', '-c', 'experiment/x')
    code(root, 'tried')
    git(root, 'switch', '-q', '-c', 'feat/contract-first-pass', 'main')
    stage(root, 'packages/ui-contract/src/x.ts', 'engine')
    commit(root, 'feat(contract): judge the round')

    const meta = squash(root, 'feat/contract-first-pass')

    passes(
      run(
        root,
        message('feat(contract): judge the round', squashedFrom(meta, 'feat/contract-first-pass')),
      ),
    )
    author(root, 'reset', '-q', '--hard')

    const line = squash(root, 'contract/trunk')

    refuses(
      landing(root, squashedFrom(line, 'contract/trunk')),
      'contract/trunk never lands on main',
      SQUASH_FORM,
    )
    author(root, 'reset', '-q', '--hard')

    const tried = squash(root, 'experiment/x')

    refuses(landing(root, squashedFrom(tried, 'experiment/x')), 'experiment/x never lands on main')
  })

  it("refuses a landing message git's cleanup reads two ways", () => {
    const fixture = trunk()
    const tip = staged(fixture)

    passes(run(fixture.root, `feat(web): show the page\n\n# note\n${squashedFrom(tip)}\n`))
    refuses(
      run(fixture.root, `# note\n\nfeat(web): show the page\n\n${squashedFrom(tip)}\n`),
      'reads one way when git strips its comment lines and another when it keeps them',
      SQUASH_FORM,
    )
  })

  it('reads the tree git commits under a temporary index', () => {
    const all = trunk()
    const tip = staged(all)

    git(all.root, 'restore', '--staged', '--', 'apps/web/src/main.tsx')
    passes(
      commitThroughHook(all.root, '-a', '-m', 'feat(web): show the page', '-m', squashedFrom(tip)),
    )
    expect(git(all.root, 'rev-parse', 'main^{tree}')).toBe(
      git(all.root, 'rev-parse', 'feat/me^{tree}'),
    )

    const some = trunk()
    const one = staged(some)

    refuses(
      commitThroughHook(
        some.root,
        '-m',
        'feat(web): show the page',
        '-m',
        squashedFrom(one),
        '--',
        SCREEN,
      ),
      `is not the tree of ${one}`,
    )
  })
})
