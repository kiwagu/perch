/**
 * Collects the anchors and codes one source file declares, as the contract check reads
 * them: `data-testid`, `testId` and `*TestId` attributes, `testId:` keys and
 * `<NAME>_TEST_ID` constants with a literal value; the suffixes of `testIdFor()`; the
 * `data-code` attributes, `code:` keys and `<NAME>_CODES` maps. A name or a `testIdFor()`
 * call passes through (its literal is declared elsewhere); an anchor built at runtime is a
 * problem, since no check can follow it. A key or a map value is a contract code only in
 * the code grammar (kebab-case): `note:TEXT_REQUIRED` is a domain code and is left out,
 * while a `data-code` literal outside the grammar is a problem. And `holdsInput={false}`
 * beside a field's anchor, for the opt-out the contract derives: a literal on the element
 * that carries the anchor as a literal, or a prop passed through.
 */

import { type Expression, parseSync, Visitor } from 'oxc-parser'

import type { Problem } from '../files'

import {
  type AnchorValue,
  anchorValue,
  attributeValue,
  isTestIdFor,
  keyName,
  staticText,
  unwrap,
} from './values'

export const RUNTIME_ANCHOR =
  'an anchor built at runtime; declare a literal, pass a prop or a <NAME>_TEST_ID constant, or derive it with testIdFor()'

export const RUNTIME_SUFFIX =
  'the suffix of testIdFor() is built at runtime; pass a literal suffix of the vocabulary'

export const HOLDS_INPUT_ANCHOR =
  "holdsInput goes on the element that carries the field's anchor as a literal"

export const HOLDS_INPUT_VALUE =
  'holdsInput is {false} or left out; the contract decides it (a prop passed through is fine)'

export interface Collected {
  file: string
  literals: Array<{ anchor: string; form: 'attribute' | 'prop' | 'key' | 'constant'; line: number }>
  derived: Array<{ suffix: string; line: number }>
  codes: Array<{ code: string; form: 'attribute' | 'key' | 'map'; line: number }>
  /** `holdsInput` written as a literal on the element of a field's anchor. */
  inputs: Array<{ anchor: string; holdsInput: boolean; line: number }>
  problems: Problem[]
}

type LiteralForm = Collected['literals'][number]['form']
type CodeForm = Collected['codes'][number]['form']

/** A file without any of these words declares no anchor and no code, and is not parsed. */
const WORDS = /data-testid|testId|TestId|_TEST_ID|data-code|code:|_CODES|holdsInput/

const TEST_ID_CONSTANT = /^[A-Z][A-Z0-9_]*_TEST_ID$/
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
      const attributes = node.attributes.flatMap((attribute) =>
        attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier'
          ? [{ name: attribute.name.name, value: attribute.value, start: attribute.start }]
          : [],
      )
      const holds = attributes.find(({ name }) => name === 'holdsInput')

      if (holds === undefined) {
        return
      }

      const expression =
        holds.value?.type === 'JSXExpressionContainer' ? holds.value.expression : undefined

      if (expression?.type === 'Identifier' || expression?.type === 'MemberExpression') {
        return
      }

      if (expression?.type !== 'Literal' || typeof expression.value !== 'boolean') {
        collected.problems.push({ file, line: line(holds.start), message: HOLDS_INPUT_VALUE })

        return
      }

      const carrier = attributes.find(({ name }) => isAnchorAttribute(name))
      const value = carrier === undefined ? undefined : attributeValue(carrier.value)

      if (value?.kind !== 'literal') {
        collected.problems.push({ file, line: line(holds.start), message: HOLDS_INPUT_ANCHOR })

        return
      }

      collected.inputs.push({
        anchor: value.text,
        holdsInput: expression.value,
        line: line(holds.start),
      })
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

      const suffix = staticText(node.arguments[1])

      if (suffix === undefined) {
        collected.problems.push({ file, line: line(node.start), message: RUNTIME_SUFFIX })
      } else {
        collected.derived.push({ suffix, line: line(node.start) })
      }
    },
  }).visit(program)

  return collected
}
