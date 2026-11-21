import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { AUGMENTED_MODULE, augmentationProblems, UNREAD_DECLARATIONS } from './augmentation'
import { SOURCE_ROOTS } from './scan'

/** The problems of a file that writes `lines`, as printed. */
const problemsOf = (lines: readonly string[], file = 'apps/web/src/augment.d.ts'): string[] =>
  augmentationProblems(lines.join('\n'), file, SOURCE_ROOTS).map(formatProblem)

/** A file that declares the module `specifier` with a draft of its own, the declaration on line 3. */
const declaring = (specifier: string, between = ' '): string[] => [
  "import type { Draft } from './draft'",
  '',
  `declare module${between}'${specifier}' {`,
  "  interface CreateDraft { readonly type: 'sample.a-button' }",
  '}',
]

describe('augmentationProblems', () => {
  it('refuses a module declaration that names a source file: a path into a root, the app alias, its packages', () => {
    for (const [file, specifier] of [
      ['apps/web/src/augment.d.ts', './organisation-create.view'],
      ['apps/web/src/features/augment.d.ts', '../pages/organisation-create.view'],
      ['apps/web/src/augment.d.ts', '.'],
      ['apps/web/build/augment.d.ts', '../src/features/organisation-create.view'],
      ['tests/e2e/augment.d.ts', '../../packages/ui/src/components/input'],
      ['scripts/augment.ts', '/abs/organisation-create.view'],
      ['apps/web/build/augment.d.ts', '@/features/organisation/organisation-create.view'],
      ['packages/data/src/augment.d.ts', '@workspace/ui'],
      ['tests/augment.d.ts', '@workspace/ui/components/input'],
      ['tests/augment.d.ts', '@workspace/web/seeding'],
    ] as const) {
      expect(problemsOf(declaring(specifier), file), `${file}: ${specifier}`).toEqual([
        `${file}:3: ${AUGMENTED_MODULE(specifier)}`,
      ])
    }
  })
  it('reads the declaration from the file itself: a comment or spaces between its words change nothing', () => {
    const refused = [
      `apps/web/src/augment.d.ts:3: ${AUGMENTED_MODULE('./organisation-create.view')}`,
    ]

    for (const between of [' /* x */ ', '/**/', ' /* a */ /* b */ ', '\t  ']) {
      expect(problemsOf(declaring('./organisation-create.view', between)), between).toEqual(refused)
    }

    // A file that holds the word but does not parse (a line break between the words breaks the
    // declaration) cannot be read for its declarations: refused.
    expect(problemsOf(["declare module './organisation-create.view' {"])).toEqual([
      `apps/web/src/augment.d.ts:1: ${UNREAD_DECLARATIONS('Expected `}` but found `EOF`')}`,
    ])
  })
  it('lets a relative declaration stand that names no file of a root', () => {
    for (const [file, specifier] of [
      ['tests/e2e/augment.d.ts', './helpers'],
      ['apps/web/src/augment.d.ts', '../build/pwa'],
      ['apps/web/build/augment.d.ts', './pwa'],
      ['packages/data/src/augment.d.ts', '../../ui/vite.config'],
    ] as const) {
      expect(problemsOf(declaring(specifier), file), `${file}: ${specifier}`).toEqual([])
    }
  })
  it('refuses it in any file, a view itself and a declaration of a script included', () => {
    const declared = ["declare module './x' {", '  interface Draft { type: string }', '}']

    expect(problemsOf(declared, 'apps/web/src/x.tsx')).toEqual([
      `apps/web/src/x.tsx:1: ${AUGMENTED_MODULE('./x')}`,
    ])
    expect(problemsOf(['export {}', ...declared], 'packages/ui/src/x.ts')).toEqual([
      `packages/ui/src/x.ts:2: ${AUGMENTED_MODULE('./x')}`,
    ])
  })
  it('lets an ambient or a package module declaration stand, and global augmentation', () => {
    expect(
      problemsOf([
        "declare module 'virtual:perch-build' {",
        '  const build: { readonly version: string }',
        '  export default build',
        '}',
        "declare module '*.surql' {",
        '  const text: string',
        '  export default text',
        '}',
        "declare module '@tanstack/react-router' {",
        '  interface Register { readonly router: unknown }',
        '}',
        "declare module '@workspace/data' {",
        '  const data: unknown',
        '}',
        'declare global {',
        '  interface Window { readonly perch: unknown }',
        '}',
        "// declare module './x' { } in a comment is no declaration",
        'const note = "declare module \'./x\'"',
      ]),
    ).toEqual([])
  })
})
