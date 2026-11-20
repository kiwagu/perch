import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { endIsReachable } from './reachable-end'

/** Whether control can run off the end of the body of `function f() { <body> }`. */
function reachable(body: string): boolean {
  const { program } = parseSync('x.ts', `function f(c) { ${body} }`, {
    lang: 'ts',
    sourceType: 'module',
  })
  const declaration = program.body[0]

  if (declaration?.type !== 'FunctionDeclaration' || declaration.body === null) {
    throw new Error('the probe declares a function with a body')
  }

  return endIsReachable(declaration.body)
}

describe('endIsReachable', () => {
  it('cannot run off the end after a return or a throw, bare or not', () => {
    expect(reachable('return')).toBe(false)
    expect(reachable('return 1')).toBe(false)
    expect(reachable("throw new Error('x')")).toBe(false)
    expect(reachable('log(); return 1')).toBe(false)
  })
  it('cannot run off the end of a block that holds a return or a throw, even before other statements', () => {
    expect(reachable('{ log(); return 1 }')).toBe(false)
    expect(reachable('{ { throw new Error() } } log()')).toBe(false)
    expect(reachable('return 1; log()')).toBe(false)
  })
  it('cannot run off the end of an if with an else whose two arms both end, however they are written', () => {
    expect(reachable('if (c) { return 1 } else { return 2 }')).toBe(false)
    expect(reachable('if (c) return 1; else return 2')).toBe(false)
    expect(reachable('if (c) return 1; else throw new Error()')).toBe(false)
    expect(reachable('if (c) { log(); return 1 } else { log(); throw new Error() }')).toBe(false)
    expect(reachable('if (c === 1) return 1; else if (c === 2) return 2; else return 3')).toBe(
      false,
    )
    expect(reachable('if (c) { if (c === 1) return 1; else return 2 } else return 3')).toBe(false)
  })
  it('can run off the end of an if that has no else, or an arm that does not end', () => {
    expect(reachable('if (c) { return 1 }')).toBe(true)
    expect(reachable('if (c) { return 1 } else { log() }')).toBe(true)
    expect(reachable('if (c) { log() } else { return 1 }')).toBe(true)
    expect(reachable('if (c) return 1; else if (c === 2) return 2')).toBe(true)
    expect(reachable('if (c) { if (c === 1) return 1 } else return 3')).toBe(true)
  })
  it('can run off the end of an empty body, an expression and a directive', () => {
    expect(reachable('')).toBe(true)
    expect(reachable('log()')).toBe(true)
    expect(reachable("'use strict'")).toBe(true)
    expect(reachable('const x = 1')).toBe(true)
  })
  it('reads no other form: a loop, a switch, a try, a label or a jump may run off, whatever it holds', () => {
    expect(reachable('while (c) { return 1 }')).toBe(true)
    expect(reachable('for (;;) { return 1 }')).toBe(true)
    expect(reachable('switch (c) { case 1: return 1; default: return 2 }')).toBe(true)
    expect(reachable('try { return 1 } catch { return 2 }')).toBe(true)
    expect(reachable('try { return 1 } finally { log() }')).toBe(true)
    expect(reachable('label: { return 1 }')).toBe(true)
    expect(reachable('while (c) { break }')).toBe(true)
    expect(reachable('if (c) { break } else { return 1 }')).toBe(true)
  })
  it('does not look into a function a statement declares', () => {
    expect(reachable('function g() { return 1 }')).toBe(true)
    expect(reachable('const g = () => { throw new Error() }')).toBe(true)
  })
})
