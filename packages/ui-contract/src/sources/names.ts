/**
 * What the scopes of a file say of a name, for following a value to the objects it may be
 * (`alternatives.ts`): what it is bound to where it is written (`locals.ts`, `bindings.ts`).
 */

import type { Expression } from 'oxc-parser'

import type { Callable } from './callable'

/**
 * A name bound to a part of another value: a destructured name, the value destructured and the
 * keys down to it; the variable of a `for…of`, each element of the value it iterates (`iterated`),
 * then the keys its head destructures.
 */
export interface Member {
  readonly object: Expression
  readonly path: readonly string[]
  readonly iterated?: true
}

/** What a declaration binds a name to: the value it declares, or the part of one (`Member`). */
export interface Bound {
  readonly value?: Expression
  readonly member?: Member
}

/** What the scopes of a file say of a name, for following a value. */
export interface Names {
  /** What a name, written at a place, is bound to: a declaration, or each one it may hold. */
  boundTo(name: string, at: number): readonly Bound[]
  /** The value of a name a `const` declares, as `Locals.constantNamed`. */
  constantNamed(name: string, at: number): Expression | undefined
  /**
   * Whether the file may change the array a name, written at a place, holds: a use of the same
   * binding that is no plain read (`changing-uses.ts`).
   */
  changed(name: string, at: number): boolean
  returnedBy(fn: Callable): Array<Expression | null>
}
