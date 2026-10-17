import { describe, expect, it } from 'vitest'

import { findSurqlLiterals } from './lint-literals'

describe('findSurqlLiterals', () => {
  it('reports string and template literals that hold SurrealQL statements', () => {
    const source = [
      "const q = 'SELECT * FROM identity'",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test contains a template literal
      'const t = `UPDATE identity SET name = ${name}`',
      'const d = "  DEFINE TABLE x"',
    ].join('\n')

    expect(findSurqlLiterals('a.ts', source)).toEqual([
      { path: 'a.ts', line: 1, rule: 'surrealql-literal', text: 'SELECT * FROM identity' },
      { path: 'a.ts', line: 2, rule: 'surrealql-literal', text: 'UPDATE identity SET name = …' },
      { path: 'a.ts', line: 3, rule: 'surrealql-literal', text: 'DEFINE TABLE x' },
    ])
  })

  it('ignores comments, plain words and lower-case prose', () => {
    const source = [
      '// SELECT * FROM identity in a comment',
      '/* DELETE everything */',
      "const label = 'SELECT'",
      "const prose = 'select a profile to update it'",
      "const pattern = /'SELECT x'/",
    ].join('\n')

    expect(findSurqlLiterals('b.tsx', source)).toEqual([])
  })

  it('reads TSX', () => {
    expect(
      findSurqlLiterals('c.tsx', "export const V = () => <p title={'DELETE identity:x'}>hi</p>"),
    ).toHaveLength(1)
  })
})
