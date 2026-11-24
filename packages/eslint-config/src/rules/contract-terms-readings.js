/**
 * How the contract-terms rule reads a declared type as the values it admits: as alternatives, each
 * a list of types that hold at once, and the string values each alternative admits. A value set is
 * closed only when it is made of string literals.
 */

import ts from 'typescript'

const KINDS = [
  ts.TypeFlags.StringLike,
  ts.TypeFlags.NumberLike,
  ts.TypeFlags.BooleanLike,
  ts.TypeFlags.BigIntLike,
  ts.TypeFlags.ESSymbolLike,
]

/** The literal types: one value each. */
const LITERALS =
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.BigIntLiteral

/** The primitive kind of `type` (its flag among `KINDS`), none for an object. */
const kindOf = (type) => KINDS.find((kind) => type.flags & kind)

/**
 * The string values a type admits, when it admits nothing but string literals; none otherwise. A
 * type parameter is read by its constraint, and `undefined` and `null` are set aside.
 */
export function closedValues(type, checker) {
  const read =
    type.flags & ts.TypeFlags.TypeParameter ? checker.getBaseConstraintOfType(type) : type

  if (read === undefined) {
    return undefined
  }

  const values = []

  for (const part of read.isUnion() ? read.types : [read]) {
    if (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) {
      continue
    }

    if (!part.isStringLiteral()) {
      return undefined
    }

    values.push(part.value)
  }

  return values.length > 0 ? values : undefined
}

/** The readings of types over one program's `checker`. */
export function readings(checker) {
  /** The members of `type` that hold a value: its union's, `undefined`, `null` and `never` aside. */
  const membersOf = (type) =>
    (type.isUnion() ? type.types : [type]).filter(
      (member) =>
        !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)),
    )

  /**
   * A type as declared, read as its alternatives, each a list of types that hold at once (an
   * intersection, written or made by several indexes that take one name); `string | Role` is two
   * of one. A type parameter is read by its constraint.
   */
  const readingOf = (type) =>
    membersOf(
      type.flags & ts.TypeFlags.TypeParameter
        ? (checker.getBaseConstraintOfType(type) ?? type)
        : type,
    ).map((member) => (member.isIntersection() ? [...member.types] : [member]))

  /** The alternatives of `a` and of `b` holding at once: each of one with each of the other. */
  const both = (a, b) => a.flatMap((left) => b.map((right) => [...left, ...right]))

  /**
   * The string values an alternative admits: one type by its own; several at once, the literal
   * one of them is when every primitive among the others admits it (an object, a brand, narrows it
   * and leaves it), and nothing when they cannot hold at once (`1` with `2`, `number` with
   * `boolean`); none, open, when no literal decides or the literal is no string.
   */
  function alternativeValues(alternative) {
    if (alternative.length === 1) {
      return closedValues(alternative[0], checker)
    }

    const literal = alternative.find((type) => type.flags & LITERALS)

    if (literal !== undefined) {
      // An object type (a brand) narrows the literal and leaves it; a primitive that does not
      // admit it leaves nothing.
      const held = alternative.every(
        (type) => kindOf(type) === undefined || checker.isTypeAssignableTo(literal, type),
      )

      if (!held) {
        return []
      }

      return literal.isStringLiteral() ? [literal.value] : undefined
    }

    const kinds = new Set(alternative.map(kindOf).filter((kind) => kind !== undefined))

    return kinds.size > 1 ? [] : undefined
  }

  /** The string values a reading admits: none, open, when one of its alternatives is open. */
  function readingValues(reading) {
    const values = reading.map(alternativeValues)

    return values.some((each) => each === undefined) ? undefined : values.flat()
  }

  return { membersOf, readingOf, both, readingValues }
}
