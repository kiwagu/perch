import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scanSources } from './scan'

const roots: string[] = []

/** A repository with the given files, the ones under `tracked` committed. */
function repository(files: Readonly<Record<string, string>>, tracked: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-scan-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })

  roots.push(root)
  git('init', '--quiet')

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  if (tracked.length > 0) {
    git('add', '--', ...tracked)
  }

  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const ANCHOR = 'export const A = <p data-testid="sample.page" />\n'

describe('scanSources', () => {
  it('collects the tracked and untracked sources under the roots, minus tests and generated files', () => {
    const root = repository(
      {
        'apps/web/src/page.tsx': ANCHOR,
        'apps/web/src/new.tsx': ANCHOR,
        'apps/web/src/ignored.tsx': ANCHOR,
        'apps/web/src/page.spec.tsx': ANCHOR,
        'apps/web/src/page.test.ts': ANCHOR,
        'apps/web/src/types.d.ts': ANCHOR,
        'apps/web/src/routes.gen.ts': ANCHOR,
        'apps/web/src/__fixtures__/page.tsx': ANCHOR,
        'apps/web/src/__snapshots__/page.tsx': ANCHOR,
        'apps/web/src/notes.md': ANCHOR,
        'apps/web/.gitignore': 'src/ignored.tsx\n',
        'packages/ui/src/button.tsx': ANCHOR,
        'packages/other/src/button.tsx': ANCHOR,
      },
      ['apps/web/src/page.tsx', 'packages/ui/src/button.tsx'],
    )

    expect(scanSources(root).map(({ file, literals }) => [file, literals.length])).toEqual([
      ['apps/web/src/new.tsx', 1],
      ['apps/web/src/page.tsx', 1],
      ['packages/ui/src/button.tsx', 1],
    ])
  })
  it('skips a tracked file that is gone from the working tree', () => {
    const root = repository({ 'apps/web/src/page.tsx': ANCHOR }, ['apps/web/src/page.tsx'])

    rmSync(join(root, 'apps/web/src/page.tsx'))

    expect(scanSources(root)).toEqual([])
  })
})
