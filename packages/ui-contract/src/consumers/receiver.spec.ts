import { parseSync, Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { assertedAnchor, calleeName } from './receiver'

/** The anchor `assertedAnchor` reads for each `toHaveAttribute` call of `source`, in order. */
const anchorsOf = (source: string): Array<string | undefined> => {
  const { program } = parseSync('a.ts', source, { lang: 'ts', sourceType: 'module' })
  const anchors: Array<string | undefined> = []

  new Visitor({
    CallExpression(node) {
      if (calleeName(node) === 'toHaveAttribute') {
        anchors.push(assertedAnchor(node))
      }
    },
  }).visit(program)

  return anchors
}

const asserted = (receiver: string, not = ''): string | undefined =>
  anchorsOf(`expect(${receiver})${not}.toHaveAttribute('data-state', 'met')\n`)[0]

describe('calleeName', () => {
  it('names a function call and a method call, and no computed one', () => {
    const names: Array<string | undefined> = []
    const { program } = parseSync('a.ts', "f();\na.b.c();\na['d']();\n(() => 1)();\n", {
      lang: 'ts',
      sourceType: 'module',
    })

    new Visitor({
      CallExpression(node) {
        names.push(calleeName(node))
      },
    }).visit(program)

    expect(names).toEqual(['f', 'c', undefined, undefined])
  })
})

describe('assertedAnchor', () => {
  it('reads the getByTestId the receiver is, on any page, frame or locator, .not included', () => {
    expect(asserted("page.getByTestId('sample.list')")).toBe('sample.list')
    expect(asserted("deviceB.getByTestId('sample.list')", '.not')).toBe('sample.list')
    expect(asserted("page.locator('main').getByTestId('sample.list')")).toBe('sample.list')
  })
  it('reads the last getByTestId of the chain, through the steps that narrow what it found', () => {
    expect(asserted("page.getByTestId('sample.list').getByTestId('sample.thing-item')")).toBe(
      'sample.thing-item',
    )
    expect(
      asserted(
        "page.getByTestId('sample.thing-item').filter({ hasText: 'x' }).and(other).nth(2).first().last()",
      ),
    ).toBe('sample.thing-item')
  })
  it('reads a string in any static form, through parentheses and TypeScript wrappers', () => {
    expect(asserted('(page.getByTestId(`sample.list` as const))!.first()')).toBe('sample.list')
    expect(asserted("page.getByTestId('sample.' + 'list')")).toBe('sample.list')
  })
  it('names no anchor for a step that reaches into the element, or a query of another kind', () => {
    expect(asserted("page.getByTestId('sample.list').locator('li')")).toBeUndefined()
    expect(asserted("page.getByTestId('sample.list').getByRole('listitem')")).toBeUndefined()
    expect(asserted("page.getByTestId('sample.list').or(other)")).toBeUndefined()
    expect(asserted('page.locator(\'[data-testid="sample.list"]\')')).toBeUndefined()
  })
  it('names no anchor for a variable, a helper, a member, or a getByTestId of an expression', () => {
    expect(asserted('list')).toBeUndefined()
    expect(asserted('list.first()')).toBeUndefined()
    expect(asserted('listOf(page)')).toBeUndefined()
    expect(asserted('items[rule]')).toBeUndefined()
    expect(asserted('page.getByTestId(anchor)')).toBeUndefined()
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test contains a template literal
    expect(asserted('page.getByTestId(`${screen}.list`)')).toBeUndefined()
  })
  it('reads only a matcher called on expect(<receiver>): not on expect.soft, another call, a spread or nothing', () => {
    expect(
      anchorsOf(
        [
          "expect.soft(page.getByTestId('sample.list')).toHaveAttribute('data-state', 'met')",
          "expect(...args).toHaveAttribute('data-state', 'met')",
          "expect().toHaveAttribute('data-state', 'met')",
          "toHaveAttribute('data-state', 'met')",
          "other(page.getByTestId('sample.list')).toHaveAttribute('data-state', 'met')",
        ].join('\n'),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined])
  })
})
