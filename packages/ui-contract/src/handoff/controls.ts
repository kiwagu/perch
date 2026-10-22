/**
 * The controls of one source file and how many carry an anchor, for the coverage note.
 * A control is a JSX element named like one (`button`, `a`, `input`, `Button`, `Link`,
 * ...) or any element with an `onClick`. It is marked when it carries a `data-testid`,
 * `testId` or `*TestId` prop, or sits inside a `<label>`. An element inside a marked
 * control without an action of its own is a part of that control and is not counted; an
 * element that passes on the props it receives is not counted either, since whoever renders
 * it decides what it carries. A control a coverage-ignore marker covers is ignored, whatever
 * it carries: declared not a test target, it is neither marked nor unmarked, and the
 * elements inside it are not taken as its parts. A marker that ignores no control (its
 * element, and its subtree for the plain form, holds none) is a problem, as is one that
 * cannot be applied. An indicator read from the source text, not a rule of the contract.
 */

import {
  type Expression,
  type JSXChild,
  type JSXElement,
  type JSXElementName,
  parseSync,
  Visitor,
} from 'oxc-parser'

import { type Problem, sortProblems } from '../files'
import {
  IGNORE_NO_CONTROL,
  IGNORE_WITHOUT_ELEMENT,
  type IgnoreMarker,
  ignoreMarkers,
} from '../sources'
import { isAnchorAttribute } from '../sources/collect'
import { attributeValue, staticText, unwrap } from '../sources/values'

/** A control by its line, its tag and, when a static one is at hand, its label. */
export interface ControlPlace {
  line: number
  tag: string
  /** The control's `aria-label`, or its text, when either is a static string. */
  label?: string
}

export interface Controls {
  /** The controls that are test targets: the marked and the unmarked ones. */
  controls: number
  marked: number
  unmarked: ControlPlace[]
  /** The controls a coverage-ignore marker declares off, with its reason. */
  ignored: Array<ControlPlace & { reason: string }>
  /**
   * The markers that cannot be applied (without a reason, or before no JSX element), and the
   * ones that ignore no control.
   */
  problems: Problem[]
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
  /** The subtree marker the element sits under, if any. */
  readonly ignoredBy: IgnoreMarker | undefined
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

/** The text of one JSX child, or undefined when it is computed. */
function childText(child: JSXChild): string | undefined {
  switch (child.type) {
    case 'JSXText':
      return child.value
    case 'JSXElement':
    case 'JSXFragment':
      return textOf(child.children)
    case 'JSXExpressionContainer':
      return child.expression.type === 'JSXEmptyExpression' ? '' : staticText(child.expression)
    default:
      return undefined
  }
}

/** The text of JSX children, or undefined when a part of it is computed. */
function textOf(children: readonly JSXChild[]): string | undefined {
  const parts = children.map(childText)

  return parts.includes(undefined) ? undefined : parts.join('')
}

/** The `aria-label` of an element, or else its text, when that is a static string. */
function labelOf(element: JSXElement): string | undefined {
  const aria = element.openingElement.attributes.find(
    (attribute) =>
      attribute.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      attribute.name.name === 'aria-label',
  )
  const named = aria?.type === 'JSXAttribute' ? attributeValue(aria.value) : undefined
  const text =
    named === undefined
      ? textOf(element.children)
      : named.kind === 'literal'
        ? named.text
        : undefined
  const label = text?.replace(/\s+/g, ' ').trim()

  return label === '' ? undefined : label
}

export function countControls(text: string, file: string): Controls {
  const starts = [0, ...[...text.matchAll(/\n/g)].map(({ index }) => index + 1)]
  const line = (offset: number): number => starts.findLastIndex((start) => start <= offset) + 1
  const { program, comments, errors } = parseSync(file, text, {
    lang: file.endsWith('x') ? 'tsx' : 'ts',
    sourceType: 'module',
  })
  const [error] = errors

  if (error !== undefined) {
    throw new Error(`${file}:${line(error.labels[0]?.start ?? 0)}: ${error.message}`)
  }

  const { markers, faults } = ignoreMarkers(text, { program, comments })
  const pending = new Map(markers.map((marker) => [marker.target, marker]))
  /** The markers that ignore at least one control. */
  const ignoring = new Set<IgnoreMarker>()
  const counted: Controls = { controls: 0, marked: 0, unmarked: [], ignored: [], problems: [] }
  const top: Context = { inLabel: false, inMarked: false, ignoredBy: undefined }
  const stack: Context[] = [top]

  new Visitor({
    JSXElement(element) {
      const context = stack.at(-1) ?? top
      const marker = pending.get(element.start)
      const ignoredBy = marker ?? context.ignoredBy
      const tag = tagOf(element.openingElement.name)
      const { names, spreads } = attributesOf(element)
      const action = names.includes('onClick')
      const control = CONTROL_TAGS.has(tag) || action
      const anchored = names.some(isAnchorAttribute)

      pending.delete(element.start)

      if (control && !spreads && (action || !context.inMarked)) {
        const label = labelOf(element)
        const place = { line: line(element.start), tag, ...(label === undefined ? {} : { label }) }

        if (ignoredBy !== undefined) {
          ignoring.add(ignoredBy)
          counted.ignored.push({ ...place, reason: ignoredBy.reason })
        } else if (anchored || context.inLabel) {
          counted.controls += 1
          counted.marked += 1
        } else {
          counted.controls += 1
          counted.unmarked.push(place)
        }
      }

      stack.push({
        inLabel: context.inLabel || tag === 'label',
        inMarked: context.inMarked || (control && anchored && ignoredBy === undefined),
        ignoredBy: marker === undefined || marker.self ? context.ignoredBy : marker,
      })
    },
    'JSXElement:exit'() {
      stack.pop()
    },
  }).visit(program)

  const unapplied = new Set(pending.values())
  const withoutElement = [...unapplied].map(({ at }) => ({ at, message: IGNORE_WITHOUT_ELEMENT }))
  const stale = markers
    .filter((marker) => !unapplied.has(marker) && !ignoring.has(marker))
    .map(({ at }) => ({ at, message: IGNORE_NO_CONTROL }))

  counted.problems = sortProblems(
    [...faults, ...withoutElement, ...stale].map(({ at, message }) => ({
      file,
      line: line(at),
      message,
    })),
  )

  return counted
}
