import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { AUGMENTED_MODULE, augmentationProblems } from './augmentation'

/** The problems of a file that writes `lines`, as printed. */
const problemsOf = (lines: readonly string[], file = 'apps/web/src/augment.d.ts'): string[] =>
  augmentationProblems(lines.join('\n'), file).map(formatProblem)

describe('augmentationProblems', () => {
  it('refuses a module declaration that may name a source file: a path, the app alias, the kit', () => {
    for (const specifier of [
      './organisation-create.view',
      '../pages/organisation-create.view',
      '..',
      '/abs/organisation-create.view',
      '@/features/organisation/organisation-create.view',
      '@workspace/ui',
      '@workspace/ui/components/input',
    ]) {
      expect(
        problemsOf([
          "import type { Draft } from './draft'",
          '',
          `declare module '${specifier}' {`,
          "  interface CreateDraft { readonly type: 'sample.a-button' }",
          '}',
        ]),
        specifier,
      ).toEqual([`apps/web/src/augment.d.ts:3: ${AUGMENTED_MODULE(specifier)}`])
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
        'declare global {',
        '  interface Window { readonly perch: unknown }',
        '}',
        "// declare module './x' { } in a comment is no declaration",
        'const note = "declare module \'./x\'"',
      ]),
    ).toEqual([])
  })
})
