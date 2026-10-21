/** A problem found in a contract file, printed as `file:line: message`. */
export interface Problem {
  readonly file: string
  readonly line?: number
  readonly message: string
}

export const formatProblem = (p: Problem): string => `${p.file}:${p.line ?? 1}: ${p.message}`

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
