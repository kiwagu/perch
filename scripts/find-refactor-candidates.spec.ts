import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./find-refactor-candidates.ts', import.meta.url))

/** The checkouts the tests made, removed after each test. */
const made: string[] = []

/** Runs git in `cwd` without signing commits, and expects it to succeed. */
function git(cwd: string, ...args: string[]): void {
  const run = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)
}

/** Writes a source file of exactly `lines` lines. */
function writeLines(root: string, path: string, lines: number): void {
  const text = Array.from({ length: lines }, (_, index) => `export const v${index} = ${index}\n`)

  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text.join(''))
}

function commit(root: string, message: string): void {
  git(root, 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', message)
}

/** A checkout of its own whose first branch is `branch`, with the files in `files` committed. */
function checkout(files: Record<string, number>, branch = 'main'): string {
  const root = mkdtempSync(join(tmpdir(), 'size-ratchet-'))

  made.push(root)
  git(root, 'init', '-q', '-b', branch)

  for (const [path, lines] of Object.entries(files)) {
    writeLines(root, path, lines)
  }

  commit(root, 'start')

  return root
}

/** Runs the size script in `root` with `args`. */
function sizes(root: string, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync('bun', [SCRIPT, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
}

const baselineOf = (root: string): unknown =>
  JSON.parse(readFileSync(join(root, 'refactor-baseline.json'), 'utf8'))

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('the size ratchet on a checkout without a baseline', () => {
  it('fails a red-zone file its branch grew, on the first run', () => {
    const root = checkout({ 'src/big.ts': 400 })

    git(root, 'switch', '-q', '-c', 'feature')
    writeLines(root, 'src/big.ts', 402)
    commit(root, 'grow')

    const run = sizes(root, '--ci')

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('src/big.ts: grew from 400 to 402 lines')
  })

  it('fails a file its branch brought into the red zone, on the first run', () => {
    const root = checkout({ 'src/big.ts': 300 })

    git(root, 'switch', '-q', '-c', 'feature')
    writeLines(root, 'src/big.ts', 410)
    commit(root, 'grow')

    const run = sizes(root, '--ci')

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('src/big.ts: 410 lines: entered the red zone')
  })

  it('fails growth that is not committed yet', () => {
    const root = checkout({ 'src/big.ts': 400 })

    writeLines(root, 'src/big.ts', 401)

    const run = sizes(root, '--ci')

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('src/big.ts: grew from 400 to 401 lines')
  })

  it("records main's sizes of the measured files and lets a shrunk file pass", () => {
    const root = checkout({ 'src/big.ts': 410, 'src/big.spec.ts': 450, 'src/small.ts': 20 })

    git(root, 'switch', '-q', '-c', 'feature')
    writeLines(root, 'src/big.ts', 405)
    commit(root, 'shrink')

    const run = sizes(root, '--ci')

    expect(run.status, run.stderr).toBe(0)
    expect(baselineOf(root)).toEqual({ 'src/big.ts': 410 })
  })

  it('measures a symlinked source file only at its target, on disk and in main alike', () => {
    const root = checkout({ 'src/big.ts': 450 })

    symlinkSync('big.ts', join(root, 'src/alias.ts'))
    commit(root, 'alias')

    const run = sizes(root, '--ci')

    expect(run.status, run.stderr).toBe(0)
    expect(baselineOf(root)).toEqual({ 'src/big.ts': 450 })
  })

  it('refuses to record growth since main when the baseline is updated', () => {
    const root = checkout({ 'src/big.ts': 400 })

    git(root, 'switch', '-q', '-c', 'feature')
    writeLines(root, 'src/big.ts', 402)
    commit(root, 'grow')

    const run = sizes(root, '--update-baseline')

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('src/big.ts: 400 -> 402')
  })

  it('names the missing main branch instead of starting from the working tree', () => {
    const root = checkout({ 'src/big.ts': 400 }, 'trunk')

    const run = sizes(root, '--ci')

    expect(run.status).toBe(2)
    expect(run.stderr).toContain('main')
  })
})
