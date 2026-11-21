/**
 * The module declarations a source file may not write: the sources check reads a view's own form
 * types from the view's file alone (`declared-type.ts`), so a `declare module` that may name one of
 * the files it reads, and could add a member there from another file (a `type` that may replace
 * an event's, `{ ...submit, ...draft }`), is refused at its line. That is a relative or an absolute
 * path, the web app's `@/` alias, or the UI kit's own package. An ambient module (`'*.surql'`), a
 * virtual one (`'virtual:perch-build'`), another package's (`'@tanstack/react-router'`) and
 * `declare global` stand.
 */

import { parseSync, Visitor } from 'oxc-parser'

import type { Problem } from '../files'

/** A module specifier that may name a source file the check reads. */
const SOURCE_SPECIFIER = /^(\.{1,2}(\/|$)|\/|@\/|@workspace\/ui(\/|$))/

/** A module declaration a file may write, as text: what the parse then reads. */
const DECLARATION = /\bmodule\s*(['"])(.*?)\1/g

/** Why a source file may not declare a module that may name one of the sources. */
export const AUGMENTED_MODULE = (specifier: string): string =>
  `declare module "${specifier}" may add to the types of a source file from another one, while the check reads a view's form types from its own file only; declare them there`

/** The module declarations of a file that may name a source file, each at its line. */
export function augmentationProblems(text: string, file: string): Problem[] {
  const written = [...text.matchAll(DECLARATION)].filter(([, , specifier]) =>
    SOURCE_SPECIFIER.test(specifier ?? ''),
  )

  if (written.length === 0) {
    return []
  }

  const line = (offset: number): number => text.slice(0, offset).split('\n').length
  const at = (offset: number, specifier: string): Problem => ({
    file,
    line: line(offset),
    message: AUGMENTED_MODULE(specifier),
  })
  const { program, errors } = parseSync(file, text, {
    lang: file.endsWith('x') ? 'tsx' : 'ts',
    sourceType: 'module',
  })

  // A file that does not parse is held to its text: what reads as such a declaration is refused.
  if (errors.length > 0) {
    return written.map((match) => at(match.index, match[2] ?? ''))
  }

  const problems: Problem[] = []

  new Visitor({
    TSModuleDeclaration: ({ id, start }) => {
      if (id.type === 'Literal' && SOURCE_SPECIFIER.test(id.value)) {
        problems.push(at(start, id.value))
      }
    },
  }).visit(program)

  return problems
}
