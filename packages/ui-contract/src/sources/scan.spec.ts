import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'
import { repository, useRepositories } from '../repository.fixture'

import { AUGMENTED_MODULE } from './augmentation'
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
  it('refuses a module declaration that may name a source, in any typed file under the roots', () => {
    const augments = "declare module './view' {\n  interface Draft { type: string }\n}\n"
    const root = repository(
      {
        'apps/web/src/view.tsx': ANCHOR,
        'apps/web/src/augment.d.ts': augments,
        'apps/web/src/view.spec.tsx': `${ANCHOR}${augments}`,
        'packages/ui/src/env.d.ts': "declare module 'virtual:x' {\n  const x: string\n}\n",
      },
      [],
    )
    const found = scanSources(root)

    // Each file that augments is said with its problem; the view is collected as before.
    expect(
      found.map(({ file, literals, problems }) => [file, literals.length, problems.length]),
    ).toEqual([
      ['apps/web/src/augment.d.ts', 0, 1],
      ['apps/web/src/view.spec.tsx', 0, 1],
      ['apps/web/src/view.tsx', 1, 0],
    ])
    expect(found[0]?.problems.map(formatProblem)).toEqual([
      `apps/web/src/augment.d.ts:1: ${AUGMENTED_MODULE('./view')}`,
    ])
  })
  it('refuses a module declaration that names a source from any typed file of the repository', () => {
    const view = '@/features/organisation/organisation-create.view'
    const augments = (specifier: string): string =>
      `export {}\n\ndeclare module '${specifier}' {\n  interface CreateDraft { type: string }\n}\n`
    const root = repository(
      {
        'apps/web/src/features/organisation/organisation-create.view.tsx': ANCHOR,
        'apps/web/build/augment.d.ts': augments(view),
        'tests/e2e/augment.mts': augments(
          '../../apps/web/src/features/organisation/organisation-create.view',
        ),
        'scripts/helpers.d.cts': augments('./helpers'),
        'packages/data/src/surql.d.ts': augments('*.surql'),
        'docs/notes.md': augments(view),
        '.gitignore': 'dist/\n',
        'apps/web/dist/augment.d.ts': augments(view),
      },
      [],
    )
    const found = scanSources(root)

    // A file outside the roots is said with its problem; one that names no source, an ignored
    // build output and a file of another kind are not read.
    expect(
      found.map(({ file, literals, problems }) => [file, literals.length, problems.length]),
    ).toEqual([
      ['apps/web/build/augment.d.ts', 0, 1],
      ['apps/web/src/features/organisation/organisation-create.view.tsx', 1, 0],
      ['tests/e2e/augment.mts', 0, 1],
    ])
    expect(found[0]?.problems.map(formatProblem)).toEqual([
      `apps/web/build/augment.d.ts:3: ${AUGMENTED_MODULE(view)}`,
    ])
  })
  it('leaves a fixture project outside the web app and the UI kit to its own module declarations', () => {
    const kit = '@workspace/ui/components/input'
    const standIn = `declare module '${kit}' {\n  export const Input: (props: object) => null\n}\n`
    const root = repository(
      {
        'apps/web/src/view.tsx': ANCHOR,
        'packages/eslint-config/src/__fixtures__/project/modules.d.ts': standIn,
        'tests/__fixtures__/modules.d.ts': standIn,
        'apps/web/build/x.d.ts': standIn,
        'apps/web/src/__fixtures__/modules.d.ts': standIn,
        'apps/web/build/__fixtures__/modules.d.ts': standIn,
        'packages/ui/src/__fixtures__/modules.d.ts': standIn,
        'packages/eslint-config/src/fixtures/modules.d.ts': standIn,
      },
      [],
    )
    const found = scanSources(root)

    // A stand-in for the kit in a fixture project of another package reaches no view: not read.
    // Inside the web app or the kit, whose programs hold the sources, a fixture is read like any
    // file, and so is a file of another package that sits under no `__fixtures__`.
    expect(
      found.map(({ file, literals, problems }) => [file, literals.length, problems.length]),
    ).toEqual([
      ['apps/web/build/__fixtures__/modules.d.ts', 0, 1],
      ['apps/web/build/x.d.ts', 0, 1],
      ['apps/web/src/__fixtures__/modules.d.ts', 0, 1],
      ['apps/web/src/view.tsx', 1, 0],
      ['packages/eslint-config/src/fixtures/modules.d.ts', 0, 1],
      ['packages/ui/src/__fixtures__/modules.d.ts', 0, 1],
    ])
    expect(found[1]?.problems.map(formatProblem)).toEqual([
      `apps/web/build/x.d.ts:1: ${AUGMENTED_MODULE(kit)}`,
    ])
  })
  it('skips a staged file that is gone from the working tree', () => {
    const root = repository({ 'apps/web/src/page.tsx': ANCHOR }, ['apps/web/src/page.tsx'])

    rmSync(join(root, 'apps/web/src/page.tsx'))

    expect(scanSources(root)).toEqual([])
  })
})
