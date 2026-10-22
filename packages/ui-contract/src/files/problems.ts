/** A problem found in a contract file, printed as `file:line: message`. */
export interface Problem {
  readonly file: string
  readonly line?: number
  readonly message: string
}

export const formatProblem = (p: Problem): string => `${p.file}:${p.line ?? 1}: ${p.message}`

/** Sorted by file and line; stable, so problems of one place keep the order they were found in. */
export const sortProblems = (problems: readonly Problem[]): Problem[] =>
  [...problems].sort((a, b) => a.file.localeCompare(b.file, 'en') || (a.line ?? 1) - (b.line ?? 1))

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** A JSON path as a reader writes it: `screens[0].anchors["user.sign-in.form"].kind`. */
export const jsonPath = (path: readonly PropertyKey[]): string =>
  path
    .map((key, index) => {
      if (typeof key === 'number') {
        return `[${key}]`
      }

      const name = String(key)

      if (IDENTIFIER.test(name)) {
        return index === 0 ? name : `.${name}`
      }

      return `[${JSON.stringify(name)}]`
    })
    .join('') || '(root)'

/** The line of each place of a file, by its JSON path: `steps[2]`, `states.profile.on["x"]`. */
export type Lines = Readonly<Record<string, number>>

/** The line of the deepest part of `path` that `lines` knows, if it knows one. */
export function lineAt(lines: Lines | undefined, path: readonly PropertyKey[]): number | undefined {
  for (let end = path.length; end > 0; end -= 1) {
    const at = jsonPath(path.slice(0, end))

    if (lines !== undefined && Object.hasOwn(lines, at)) {
      return lines[at]
    }
  }

  return undefined
}
