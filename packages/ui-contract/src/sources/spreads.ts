/**
 * What a spread on an element supplies, as far as its file says (`locals.ts`): the collector counts
 * each prop as written on the element, so a view cannot slip a field fact past the check by
 * grouping its props in an object or a helper (`{...field('email')}`). A prop counts as certain
 * only where every branch the spread may take supplies it, so a mark one branch leaves out is still
 * wanted; a branch the file cannot follow is said as such, for the collector to refuse on an
 * element whose anchor it reads.
 */

import type { Expression, ObjectExpression } from 'oxc-parser'

import { type Alternative, DEPTH } from './alternatives'
import type { Locals } from './locals'
import { keyName } from './values'

/** A prop an object supplies, by its name, with the value it is written with. */
export interface SuppliedProp {
  readonly name: string
  readonly value: Expression
}

export interface Supplied {
  /** Every prop some branch supplies, with its value. */
  readonly props: readonly SuppliedProp[]
  /** The names every branch supplies. */
  readonly certain: ReadonlySet<string>
  /** Whether every branch can be followed. */
  readonly followed: boolean
}

const NOTHING: Supplied = { props: [], certain: new Set(), followed: true }
const UNKNOWN: Supplied = { props: [], certain: new Set(), followed: false }

/** What a spread of `argument`, written at `at`, supplies (`{ ...field(name), onChange }`). */
export function suppliedBy(locals: Locals, argument: Expression, at: number): Supplied {
  const ofAlternatives = (alternatives: readonly Alternative[], depth: number): Supplied => {
    const each = alternatives.map((object) =>
      object === undefined ? UNKNOWN : object === null ? NOTHING : ofObject(object, depth),
    )
    const [first, ...rest] = each

    return {
      props: each.flatMap(({ props }) => props),
      certain: new Set(
        [...(first?.certain ?? [])].filter((name) =>
          rest.every(({ certain }) => certain.has(name)),
        ),
      ),
      followed: each.every(({ followed }) => followed),
    }
  }
  const ofObject = (object: ObjectExpression, depth: number): Supplied => {
    if (depth >= DEPTH) {
      return UNKNOWN
    }

    const parts = object.properties.map((property): Supplied => {
      if (property.type === 'SpreadElement') {
        return ofAlternatives(locals.objectsOf(property.argument, property.start), depth + 1)
      }

      const name = property.kind === 'init' ? keyName(property.key, property.computed) : undefined

      return name === undefined || property.method
        ? NOTHING
        : { props: [{ name, value: property.value }], certain: new Set([name]), followed: true }
    })

    return {
      props: parts.flatMap(({ props }) => props),
      certain: new Set(parts.flatMap(({ certain }) => [...certain])),
      followed: parts.every(({ followed }) => followed),
    }
  }

  return ofAlternatives(locals.objectsOf(argument, at), 0)
}
