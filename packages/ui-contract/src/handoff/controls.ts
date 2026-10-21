/**
 * The controls of one source file and how many carry an anchor, for the coverage note.
 * A control is a JSX element named like one (`button`, `a`, `input`, `Button`, `Link`,
 * ...) or any element with an `onClick`. It is marked when it carries a `data-testid`,
 * `testId` or `*TestId` prop, or sits inside a `<label>`. An element inside a marked
 * control without an action of its own is a part of that control and is not counted; an
 * element that passes on the props it receives is not counted either, since whoever renders
 * it decides what it carries.
 * An indicator read from the source text, not a rule of the contract.
 */

import {
  type Expression,
  type JSXElement,
  type JSXElementName,
  parseSync,
  Visitor,
} from 'oxc-parser'

import { isAnchorAttribute } from '../sources/collect'
import { unwrap } from '../sources/values'

export interface Controls {
  controls: number
  marked: number
  unmarked: Array<{ line: number; tag: string }>
}

export const CONTROL_TAGS: ReadonlySet<string> = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'Button',
  'Link',
  'Input',
  'Textarea',
  'OptionSelect',
  'ConfirmDialog',
  'AlertDialogAction',
  'AlertDialogCancel',
])

/** What an element passes down to the elements inside it. */
interface Context {
  readonly inLabel: boolean
  readonly inMarked: boolean
}

const tagOf = (name: JSXElementName): string => {
  switch (name.type) {
    case 'JSXIdentifier':
      return name.name
    case 'JSXNamespacedName':
      return `${name.namespace.name}:${name.name.name}`
    case 'JSXMemberExpression':
      return `${name.object.type === 'JSXIdentifier' ? name.object.name : tagOf(name.object)}.${name.property.name}`
  }
}

/**
 * Whether a spread passes on props the component received (`{...props}`, `{...rest}`,
 * `{...props.link}`): then whoever renders the component decides what it carries. A spread
 * built by a call (`{...field('email')}`) only fills attributes, and the element still counts.
 */
const passesOn = (argument: Expression): boolean => {
  const value = unwrap(argument)

  return value.type === 'Identifier' || value.type === 'MemberExpression'
}

function attributesOf(element: JSXElement) {
  const names: string[] = []
  let spreads = false

  for (const attribute of element.openingElement.attributes) {
    if (attribute.type === 'JSXSpreadAttribute') {
      spreads ||= passesOn(attribute.argument)
    } else if (attribute.name.type === 'JSXIdentifier') {
      names.push(attribute.name.name)
    }
  }

  return { names, spreads }
}

export function countControls(text: string, file: string): Controls {
  const starts = [0, ...[...text.matchAll(/\n/g)].map(({ index }) => index + 1)]
  const line = (offset: number): number => starts.findLastIndex((start) => start <= offset) + 1
  const { program, errors } = parseSync(file, text, {
    lang: file.endsWith('x') ? 'tsx' : 'ts',
    sourceType: 'module',
  })
  const [error] = errors

  if (error !== undefined) {
    throw new Error(`${file}:${line(error.labels[0]?.start ?? 0)}: ${error.message}`)
  }

  const counted: Controls = { controls: 0, marked: 0, unmarked: [] }
  const stack: Context[] = [{ inLabel: false, inMarked: false }]

  new Visitor({
    JSXElement(element) {
      const context = stack.at(-1) ?? { inLabel: false, inMarked: false }
      const tag = tagOf(element.openingElement.name)
      const { names, spreads } = attributesOf(element)
      const action = names.includes('onClick')
      const control = CONTROL_TAGS.has(tag) || action
      const anchored = names.some(isAnchorAttribute)

      if (control && !spreads && (action || !context.inMarked)) {
        counted.controls += 1

        if (anchored || context.inLabel) {
          counted.marked += 1
        } else {
          counted.unmarked.push({ line: line(element.start), tag })
        }
      }

      stack.push({
        inLabel: context.inLabel || tag === 'label',
        inMarked: context.inMarked || (control && anchored),
      })
    },
    'JSXElement:exit'() {
      stack.pop()
    },
  }).visit(program)

  return counted
}
