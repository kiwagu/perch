/**
 * Collects the anchors and codes one source file declares, as the contract check reads
 * them: `data-testid`, `testId` and `*TestId` attributes, `testId:` keys and
 * `<NAME>_TEST_ID` constants with a literal value; the suffixes of `testIdFor()`, each with
 * its base when that is a literal; the
 * `data-code` attributes, `code:` keys and `<NAME>_CODES` maps. A name or a `testIdFor()`
 * call passes through (its literal is declared elsewhere); an anchor built at runtime is a
 * problem, since no check can follow it. A key or a map value is a contract code only in
 * the code grammar (kebab-case): `note:TEXT_REQUIRED` is a domain code and is left out,
 * while a `data-code` literal outside the grammar is a problem. And `holdsInput` and `marksState`
 * beside a field's anchor, which the contract decides and the kit takes from its field facts: a
 * boolean literal, or a name or a member passed as written, on the element that carries the anchor
 * as a literal or as `testIdFor()` of two literals (a paged list's size select, with the base it
 * derives from), or through a `<NAME>_TEST_ID` constant the file declares (`locals.ts`); a prop passed through on an element that carries no anchor the check can read (a
 * wrapper handing its own anchor on) is let by. And the facets the contract decides on a control's element, `maxLength`, `type`,
 * `aria-invalid` and `disabled`, as their source text on an element that carries its anchor so. A
 * prop a spread on the element supplies counts as written there, at the spread (`spreads.ts`).
 */

import { type Expression, type JSXAttributeValue, parseSync, Visitor } from 'oxc-parser'

import type { Problem } from '../files'

import { askedEventOf } from './asked-event'
import { constantAnchorOf, localsOf } from './locals'
import { spreadPropsOf } from './spreads'
import {
  type AnchorValue,
  anchorValue,
  attributeValue,
  type CarriedAnchor,
  carriedAnchor,
  isTestIdFor,
  keyName,
  staticText,
  TEST_ID_CONSTANT,
  unwrap,
} from './values'

export const RUNTIME_ANCHOR =
  'an anchor built at runtime; declare a literal, pass a prop or a <NAME>_TEST_ID constant, or derive it with testIdFor()'

export const RUNTIME_SUFFIX =
  'the suffix of testIdFor() is built at runtime; pass a literal suffix of the vocabulary'

/** Why a view writes none of the props the contract decides for a field and the kit takes. */
export const LEFT_TO_THE_KIT = "the kit takes it from the contract's field facts; leave it out"

export const HOLDS_INPUT_ANCHOR = `holdsInput on an element that carries no anchor as a literal or as testIdFor() of two literals: ${LEFT_TO_THE_KIT}`

export const HOLDS_INPUT_VALUE = `holdsInput is neither a boolean literal nor a prop passed through: ${LEFT_TO_THE_KIT}`

export const MARKS_STATE_ANCHOR = `marksState on an element that carries no anchor as a literal or as testIdFor() of two literals: ${LEFT_TO_THE_KIT}`

export const MARKS_STATE_VALUE = `marksState is neither a boolean literal nor a prop passed through: ${LEFT_TO_THE_KIT}`

/**
 * What a view writes for a flag the contract decides: a boolean literal's value, or the source of
 * a name or a member passed as written (`localFlag`, `props.mark`).
 */
export type FlagValue = boolean | string

export interface Collected {
  file: string
  literals: Array<{ anchor: string; form: 'attribute' | 'prop' | 'key' | 'constant'; line: number }>
  /** The suffix of each `testIdFor()`, with its base when the call writes it as a literal. */
  derived: Array<{ suffix: string; base?: string; line: number }>
  codes: Array<{ code: string; form: 'attribute' | 'key' | 'map'; line: number }>
  /** `holdsInput` written on the element of an anchor, with the base of a derived one. */
  inputs: Array<{ anchor: string; base?: string; holdsInput: FlagValue; line: number }>
  /** `marksState` written on the element of an anchor, with the base of a derived one. */
  colours: Array<{ anchor: string; base?: string; marksState: FlagValue; line: number }>
  /**
   * A facet prop on the element of an anchor, with the base of a derived one, and its value as
   * written: an expression's source with each run of whitespace one space, a string with its
   * quotes, nothing for a bare attribute.
   */
  props: Array<{
    anchor: string
    base?: string
    name: FacetProp
    text: string
    line: number
    /** For `disabled`, the event its `!props.can(…)` asks about, where the file says (`asked-event.ts`). */
    asks?: string
  }>
  problems: Problem[]
}

/**
 * The props of a control's element whose value the contract decides (`facets.ts`): `aria-invalid`
 * and `disabled` it calls for, `maxLength` and `type` the kit takes from the field facts.
 */
export const FACET_PROPS = ['maxLength', 'type', 'aria-invalid', 'disabled'] as const

export type FacetProp = (typeof FACET_PROPS)[number]

type LiteralForm = Collected['literals'][number]['form']
type CodeForm = Collected['codes'][number]['form']

/** A file without any of these words declares no anchor and no code, and is not parsed. */
const WORDS = /data-testid|testId|TestId|_TEST_ID|data-code|code:|_CODES|holdsInput|marksState/

/** A boolean prop the contract decides, and what is said of it when the source writes it wrong. */
interface Flag {
  readonly name: string
  readonly anchorMessage: string
  readonly valueMessage: string
}

const HOLDS_INPUT: Flag = {
  name: 'holdsInput',
  anchorMessage: HOLDS_INPUT_ANCHOR,
  valueMessage: HOLDS_INPUT_VALUE,
}

const MARKS_STATE: Flag = {
  name: 'marksState',
  anchorMessage: MARKS_STATE_ANCHOR,
  valueMessage: MARKS_STATE_VALUE,
}

interface ElementAttribute {
  readonly name: string
  readonly value: JSXAttributeValue | null
  /** The value a spread on the element supplies the prop with, where one does. */
  readonly spread?: Expression
  readonly start: number
}

const CODES_CONSTANT = /^[A-Z][A-Z0-9_]*_CODES$/

/** The grammar of a contract code: `welcome`, `devices-read-failed`. */
const CODE = /^[a-z]+(-[a-z0-9]+)*$/

/** An attribute that carries an anchor: `data-testid`, `testId` or a `*TestId` prop. */
export const isAnchorAttribute = (name: string): boolean =>
  name === 'data-testid' || name === 'testId' || name.endsWith('TestId')

export function collectFromSource(text: string, file: string): Collected {
  const collected: Collected = {
    file,
    literals: [],
    derived: [],
    codes: [],
    inputs: [],
    colours: [],
    props: [],
    problems: [],
  }

  if (!WORDS.test(text)) {
    return collected
  }

  const line = (offset: number): number => text.slice(0, offset).split('\n').length
  const { program, errors } = parseSync(file, text, {
    lang: file.endsWith('x') ? 'tsx' : 'ts',
    sourceType: 'module',
  })
  const [error] = errors

  if (error !== undefined) {
    collected.problems.push({
      file,
      line: line(error.labels[0]?.start ?? 0),
      message: `cannot parse the file: ${error.message}`,
    })

    return collected
  }

  const anchor = (value: AnchorValue, form: LiteralForm, at: number): void => {
    if (value.kind === 'literal') {
      collected.literals.push({ anchor: value.text, form, line: line(at) })
    } else if (value.kind === 'runtime') {
      collected.problems.push({ file, line: line(at), message: RUNTIME_ANCHOR })
    }
  }

  const code = (value: string | undefined, form: CodeForm, at: number): void => {
    if (value === undefined) {
      return
    }

    if (CODE.test(value)) {
      collected.codes.push({ code: value, form, line: line(at) })
    } else if (form === 'attribute') {
      const message = `data-code "${value}" is not a kebab-case code`

      collected.problems.push({ file, line: line(at), message })
    }
  }

  const locals = localsOf(program)

  /**
   * The anchor an element carries as a literal or as `testIdFor()` of two literals, or through a
   * `<NAME>_TEST_ID` constant of the file that holds one, if any.
   */
  const carriedBy = (attributes: readonly ElementAttribute[]): CarriedAnchor | undefined => {
    const carrier = attributes.find(
      (attribute) => attribute.spread === undefined && isAnchorAttribute(attribute.name),
    )

    return carrier === undefined
      ? undefined
      : (carriedAnchor(carrier.value) ?? constantAnchorOf(locals, carrier.value, carrier.start))
  }

  /** The expression of an attribute's value, or the one a spread supplies; none for a string. */
  const expressionOf = ({ value, spread }: ElementAttribute): Expression | undefined =>
    spread ??
    (value?.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression'
      ? value.expression
      : undefined)

  /** The source of an attribute's value: an expression's, a string's with its quotes, or none. */
  const sourceOf = ({ value, spread }: ElementAttribute): string => {
    const node = spread ?? (value?.type === 'JSXExpressionContainer' ? value.expression : value)

    return node === null ? '' : text.slice(node.start, node.end).replace(/\s+/g, ' ')
  }

  /**
   * A flag prop of an element, with the anchor the element carries as a literal or as
   * `testIdFor()` of two literals: a boolean literal's value, or a name or a member as written,
   * whatever the expression (the comparison refuses either on a declared field). A name or a
   * member on an element with no such anchor is a wrapper passing the prop on, and is let by; any
   * other value is a problem, and so is a boolean literal on an element with no such anchor.
   */
  const flag = (
    attributes: readonly ElementAttribute[],
    { name, anchorMessage, valueMessage }: Flag,
  ): (CarriedAnchor & { value: FlagValue; line: number }) | undefined => {
    const written = attributes.find((attribute) => attribute.name === name)

    if (written === undefined) {
      return undefined
    }

    const expression = expressionOf(written)
    const passed = expression?.type === 'Identifier' || expression?.type === 'MemberExpression'
    const literal =
      expression?.type === 'Literal' && typeof expression.value === 'boolean'
        ? expression.value
        : undefined

    if (!passed && literal === undefined) {
      collected.problems.push({ file, line: line(written.start), message: valueMessage })

      return undefined
    }

    const carried = carriedBy(attributes)

    if (carried === undefined) {
      if (!passed) {
        collected.problems.push({ file, line: line(written.start), message: anchorMessage })
      }

      return undefined
    }

    return { ...carried, value: literal ?? sourceOf(written), line: line(written.start) }
  }

  /** The facet props of an element that carries its anchor so; an element passed one is let by. */
  const facets = (attributes: readonly ElementAttribute[]): void => {
    const carried = carriedBy(attributes)

    if (carried === undefined) {
      return
    }

    for (const attribute of attributes) {
      const prop = FACET_PROPS.find((facet) => facet === attribute.name)

      if (prop !== undefined) {
        const expression = expressionOf(attribute)
        const asks =
          prop === 'disabled' && expression !== undefined
            ? askedEventOf(locals, expression, expression.start)
            : undefined

        collected.props.push({
          ...carried,
          name: prop,
          text: sourceOf(attribute),
          line: line(attribute.start),
          ...(asks === undefined ? {} : { asks }),
        })
      }
    }
  }

  new Visitor({
    JSXAttribute(node) {
      const name = node.name.type === 'JSXIdentifier' ? node.name.name : undefined

      if (name === 'data-code') {
        const value = attributeValue(node.value)

        code(value.kind === 'literal' ? value.text : undefined, 'attribute', node.start)
      } else if (name !== undefined && isAnchorAttribute(name)) {
        const form = name === 'data-testid' ? 'attribute' : 'prop'

        anchor(attributeValue(node.value), form, node.start)
      }
    },
    JSXOpeningElement(node) {
      // A prop a spread supplies counts as written on the element, at the spread.
      const attributes = node.attributes.flatMap((attribute): ElementAttribute[] =>
        attribute.type === 'JSXSpreadAttribute'
          ? spreadPropsOf(locals, attribute.argument, attribute.start).map(({ name, value }) => ({
              name,
              value: null,
              spread: value,
              start: attribute.start,
            }))
          : attribute.name.type === 'JSXIdentifier'
            ? [{ name: attribute.name.name, value: attribute.value, start: attribute.start }]
            : [],
      )
      const holds = flag(attributes, HOLDS_INPUT)
      const marks = flag(attributes, MARKS_STATE)

      facets(attributes)

      if (holds !== undefined) {
        const { value: holdsInput, ...carried } = holds

        collected.inputs.push({ ...carried, holdsInput })
      }

      if (marks !== undefined) {
        const { value: marksState, ...carried } = marks

        collected.colours.push({ ...carried, marksState })
      }
    },
    ObjectExpression(node) {
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.kind !== 'init') {
          continue
        }

        const key = keyName(property.key, property.computed)

        if (key === 'testId') {
          anchor(anchorValue(property.value), 'key', property.start)
        } else if (key === 'code') {
          code(staticText(property.value), 'key', property.start)
        }
      }
    },
    VariableDeclarator(node) {
      if (node.id.type !== 'Identifier' || node.init === null) {
        return
      }

      if (TEST_ID_CONSTANT.test(node.id.name)) {
        anchor(anchorValue(node.init), 'constant', node.start)
      } else if (CODES_CONSTANT.test(node.id.name)) {
        const map = unwrap(node.init)

        for (const property of map.type === 'ObjectExpression' ? map.properties : []) {
          if (property.type === 'Property') {
            code(staticText(property.value), 'map', property.start)
          }
        }
      }
    },
    CallExpression(node) {
      if (!isTestIdFor(node.callee as Expression)) {
        return
      }

      const base = staticText(node.arguments[0])
      const suffix = staticText(node.arguments[1])

      if (suffix === undefined) {
        collected.problems.push({ file, line: line(node.start), message: RUNTIME_SUFFIX })
      } else {
        collected.derived.push({
          suffix,
          ...(base === undefined ? {} : { base }),
          line: line(node.start),
        })
      }
    },
  }).visit(program)

  return collected
}
