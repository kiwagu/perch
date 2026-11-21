/**
 * The module declarations no file of the repository may write: the sources check reads a view's
 * own form types from the view's file alone (`declared-type.ts`), so a `declare module` that names
 * a file under a source root, and could add a member there from another file (a `type` that may
 * replace an event's, `{ ...submit, ...draft }`), is refused at its line. That is a relative path
 * that resolves, against the declaring file, into a root; an absolute path; the web app's `@/`
 * alias; or the package of a root (`@workspace/web`, `@workspace/ui`). An ambient module
 * (`'*.surql'`), a virtual one (`'virtual:perch-build'`), another package's
 * (`'@tanstack/react-router'`), a relative one that names no file of a root and `declare global`
 * stand. A backslash in a specifier separates its segments as `/` does, the way TypeScript reads
 * it, so `'..\\src\\x'` names what `'../src/x'` names. Each declaration is read from the parsed
 * file, whatever comment or line it holds between its words; only a file without the word `module`
 * is not parsed.
 */

import { posix } from 'node:path'

import { parseSync, Visitor } from 'oxc-parser'

import type { Problem } from '../files'

/** A specifier that names a source file whatever file declares it: a path, the alias, a package. */
const SOURCE_SPECIFIER = /^(\/|@\/|@workspace\/(web|ui)(\/|$))/

const RELATIVE = /^\.{1,2}(\/|$)/

/** Why a file may not declare a module that names one of the sources. */
export const AUGMENTED_MODULE = (specifier: string): string =>
  `declare module "${specifier}" may add to the types of a source file from another one, while the check reads a view's form types from its own file only; declare them there`

/** Why a file whose module declarations are to be read is refused when it does not parse. */
export const UNREAD_DECLARATIONS = (message: string): string =>
  `cannot parse the file to read its module declarations: ${message}`

/**
 * The module declarations of `file` (a repository path) that name a file under one of `roots`,
 * each at its line.
 */
export function augmentationProblems(
  text: string,
  file: string,
  roots: readonly string[],
): Problem[] {
  if (!text.includes('module')) {
    return []
  }

  const line = (offset: number): number => text.slice(0, offset).split('\n').length
  const { program, errors } = parseSync(file, text, {
    lang: file.endsWith('x') ? 'tsx' : 'ts',
    sourceType: 'module',
  })
  const [error] = errors

  // A file that does not parse cannot be read for its declarations: it is refused.
  if (error !== undefined) {
    return [
      {
        file,
        line: line(error.labels[0]?.start ?? 0),
        message: UNREAD_DECLARATIONS(error.message),
      },
    ]
  }

  const named = (specifier: string): boolean => {
    // TypeScript takes a backslash for a separator when it resolves the specifier.
    const path = specifier.replaceAll('\\', '/')

    if (!RELATIVE.test(path)) {
      return SOURCE_SPECIFIER.test(path)
    }

    const resolved = posix.join(posix.dirname(file), path)

    return roots.some((root) => resolved === root || resolved.startsWith(`${root}/`))
  }
  const problems: Problem[] = []

  new Visitor({
    TSModuleDeclaration: ({ id, start }) => {
      if (id.type === 'Literal' && named(id.value)) {
        problems.push({ file, line: line(start), message: AUGMENTED_MODULE(id.value) })
      }
    },
  }).visit(program)

  return problems
}
