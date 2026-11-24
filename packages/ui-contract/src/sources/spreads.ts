/**
 * What a spread on an element supplies, as far as its file says (`locals.ts`): the collector counts
 * each prop as written on the element, so a view cannot slip a field fact past the check by
 * grouping its props in an object or a helper (`{...field('email')}`). A prop counts as certain
 * only where every branch the spread may take supplies it, so a mark one branch leaves out is still
 * wanted; a branch the file cannot follow, or an object with a key the file does not state, is said
 * as such, for the collector to refuse on an element whose anchor it reads. What every branch it
 * can follow supplies is said too, so an anchor all of those supply is the element's, and so is the
 * value under each key the file does not state, which may be the anchor's. A spread whose chain the
 * check gives up following at `DEPTH` is said as abandoned, for the collector to refuse whatever
 * the element's anchor: the anchor itself may lie past the limit.
 */

import type { Expression, ObjectExpression } from 'oxc-parser'

import { type Alternative, DEEP, DEPTH, isNothing } from './alternatives'
import type { Locals } from './locals'
import { statedKeyName } from './values'

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
  /** The names every branch the file can follow supplies, the ones it cannot follow left aside. */
  readonly followedCertain: ReadonlySet<string>
  /** Whether every branch can be followed. */
  readonly followed: boolean
  /** The value of each property whose key the file does not state: it may supply any prop. */
  readonly unstated: readonly Expression[]
  /** Whether some branch was given up at `DEPTH`: what it supplies, an anchor too, is unread. */
  readonly abandoned: boolean
}

const NOTHING: Supplied = {
  props: [],
  certain: new Set(),
  followedCertain: new Set(),
  followed: true,
  unstated: [],
  abandoned: false,
}
const UNKNOWN: Supplied = {
  props: [],
  certain: new Set(),
  followedCertain: new Set(),
  followed: false,
  unstated: [],
  abandoned: false,
}
const ABANDONED: Supplied = { ...UNKNOWN, abandoned: true }

/** The names every one of `sets` has; none for no set. */
const commonTo = (sets: ReadonlyArray<ReadonlySet<string>>): Set<string> => {
  const [first, ...rest] = sets

  return new Set([...(first ?? [])].filter((name) => rest.every((set) => set.has(name))))
}

/** What a spread of `argument`, written at `at`, supplies (`{ ...field(name), onChange }`). */
export function suppliedBy(locals: Locals, argument: Expression, at: number): Supplied {
  const ofAlternatives = (alternatives: readonly Alternative[], depth: number): Supplied => {
    const each = alternatives.map((object) =>
      object === undefined
        ? UNKNOWN
        : object === DEEP
          ? ABANDONED
          : isNothing(object)
            ? NOTHING
            : ofObject(object, depth),
    )

    return {
      props: each.flatMap(({ props }) => props),
      certain: commonTo(each.map(({ certain }) => certain)),
      followedCertain: commonTo(
        each
          .filter((_, index) => alternatives[index] !== undefined && alternatives[index] !== DEEP)
          .map((it) => it.followedCertain),
      ),
      followed: each.every(({ followed }) => followed),
      unstated: each.flatMap(({ unstated }) => unstated),
      abandoned: each.some(({ abandoned }) => abandoned),
    }
  }
  const ofObject = (object: ObjectExpression, depth: number): Supplied => {
    if (depth >= DEPTH) {
      return ABANDONED
    }

    const parts = object.properties.map((property): Supplied => {
      if (property.type === 'SpreadElement') {
        return ofAlternatives(locals.objectsOf(property.argument, property.start), depth + 1)
      }

      if (property.method) {
        return NOTHING
      }

      // A getter, a setter or a key the file does not state may supply any prop: not followed.
      const name =
        property.kind === 'init'
          ? statedKeyName(property.key, property.computed, locals.constantNamed)
          : undefined

      if (name === undefined) {
        return property.kind === 'init' ? { ...UNKNOWN, unstated: [property.value] } : UNKNOWN
      }

      return {
        props: [{ name, value: property.value }],
        certain: new Set([name]),
        followedCertain: new Set([name]),
        followed: true,
        unstated: [],
        abandoned: false,
      }
    })

    return {
      props: parts.flatMap(({ props }) => props),
      certain: new Set(parts.flatMap(({ certain }) => [...certain])),
      followedCertain: new Set(parts.flatMap(({ followedCertain }) => [...followedCertain])),
      followed: parts.every(({ followed }) => followed),
      unstated: parts.flatMap(({ unstated }) => unstated),
      abandoned: parts.some(({ abandoned }) => abandoned),
    }
  }

  return ofAlternatives(locals.objectsOf(argument, at), 0)
}
