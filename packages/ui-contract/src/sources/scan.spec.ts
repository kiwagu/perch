import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { repository, useRepositories } from '../repository.fixture'

import { scanSources } from './scan'

useRepositories()

const ANCHOR = 'export const A = <p data-testid="sample.page" />\n'

describe('scanSources', () => {
  it('collects the staged and untracked sources under the roots, minus tests and generated files', () => {
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
  it('skips a staged file that is gone from the working tree', () => {
    const root = repository({ 'apps/web/src/page.tsx': ANCHOR }, ['apps/web/src/page.tsx'])

    rmSync(join(root, 'apps/web/src/page.tsx'))

    expect(scanSources(root)).toEqual([])
  })
})
