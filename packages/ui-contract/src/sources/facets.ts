/**
 * The facets the contract decides on a control's element, held where the sources write them on
 * the element that carries its anchor (`Collected.props`). Each rule of the table says, of one
 * prop, the anchors it may stand on, the idiom it is written in there, and on which of them the
 * contract calls for it:
 *
 * - `maxLength={N}`, the literal, on a text field whose value takes at most N characters and is
 *   not read-only (`fieldValueOf`), and on no other element;
 * - `aria-invalid={concerns === '<key>' ? true : undefined}` on each field an error of its screen
 *   names in its `fields` (`form` names none), and on no other element;
 * - `disabled={!props.can(<its event>)}` on a control of `ENABLED_BY_STATE_KINDS` whose anchor is
 *   an event of its screen's flow, called for where a state the machine can be in renders it
 *   (`meta.renders`, `isRendered`) and does not handle it; it may stand on such a control that
 *   every state handles too, as the machine's own answer; never on a link, a text field or a
 *   control no state handles.
 *
 * A prop where the contract puts none, or in another idiom, is a problem at its line; one the
 * contract calls for and the element lacks, at the anchor's first literal, except in ahead mode:
 * the contract runs ahead of the app on a branch, so the app may lag behind it, never go beyond.
 */

import {
  ENABLED_BY_STATE_KINDS,
  isRendered,
  listedBy,
  TEXT_FIELD_KINDS,
  WHOLE_FORM,
} from '../anchors'
import { declaredAnchors, own } from '../check'
import {
  type FlowNode,
  fieldValueOf,
  flowNodes,
  type Model,
  type Problem,
  type RegionStateNode,
  type ScreensFile,
} from '../files'

import type { Collected, FacetProp } from './collect'

interface Place {
  readonly file: string
  readonly line: number
}

export interface Facets {
  readonly collected: readonly Collected[]
  readonly screens: ScreensFile
  readonly model: Model
  /** The first place each anchor a source renders as a literal is written. */
  readonly rendered: ReadonlyMap<string, Place>
  /** The contract runs ahead of the app: a facet not written yet is allowed. */
  readonly ahead: boolean
}

/** How the prop is written on one anchor, and why the contract calls for it there, if it does. */
interface Held {
  readonly idiom: string
  readonly pattern: RegExp
  /** Why the element carries it; none where it may stand and need not. */
  readonly because?: string
}

/** What the contract says of one prop: the anchors it stands on, and why it stands on no other. */
interface Facet {
  readonly name: FacetProp
  readonly on: ReadonlyMap<string, Held>
  readonly elsewhere: string
}

type Rule = (facets: Facets) => Facet

/** A state of a flow: of the root, plain or parallel, or of a region. */
type StateNode = Exclude<FlowNode, { kind: 'region' }>

const MARK_IDIOM = "concerns === '<key>' ? true : undefined"
const MARK = /^concerns === '[a-z][a-z-]*' \? true : undefined$/
const ENABLE_IDIOM = '!props.can(<its event>)'
const ENABLE = /^!\s*(props\.)?can\(/

/** The limit of a text field: the `maxLength` of its value, unless the value is read-only. */
const limits: Rule = ({ screens, model }) => ({
  name: 'maxLength',
  on: new Map(
    declaredAnchors(screens).flatMap(({ anchor, def, screen }) => {
      const value = TEXT_FIELD_KINDS.has(def.kind)
        ? fieldValueOf(anchor, screen, screens.platform, model)
        : undefined
      const limit = value?.readOnly === true ? undefined : value?.maxLength

      return limit === undefined
        ? []
        : [
            [
              anchor,
              {
                idiom: `${limit}`,
                pattern: new RegExp(`^${limit}$`),
                because: `its value takes at most ${limit} characters`,
              },
            ] as const,
          ]
    }),
  ),
  elsewhere:
    'the contract gives its value no maxLength (a read-only value takes none); leave it out',
})

/** The mark of a field: each field an error's code concerns, never `form`. */
const marks: Rule = ({ screens }) => ({
  name: 'aria-invalid',
  on: new Map(
    declaredAnchors(screens).flatMap(({ anchor: error, def }) =>
      Object.entries(def.fields ?? {})
        .filter(([, field]) => field !== WHOLE_FORM)
        .map(
          ([code, field]) =>
            [
              field,
              {
                idiom: MARK_IDIOM,
                pattern: MARK,
                because: `the code "${code}" of "${error}" concerns it`,
              },
            ] as const,
        ),
    ),
  ),
  elsewhere: 'no error of its screen names it in its fields; leave it out',
})

/**
 * A state the machine can be in that renders `event` and does not handle it, by its path: a plain
 * state of the root, or a parallel state with one state of each of its regions. A parallel state
 * whose own `on` handles it, or one of whose regions handles it in every state, handles it in each;
 * otherwise a state of a region that does not handle it, with the others in one that does not
 * either, renders it where it or its parallel state lists it, or where no state lists it.
 */
function unhandledWhere(nodes: readonly FlowNode[], event: string): string | undefined {
  const states = nodes.filter((node): node is StateNode => node.kind !== 'region')
  const regionStates = states.filter(
    (node): node is RegionStateNode => node.kind === 'region-state',
  )
  const listed = states.flatMap((node) => listedBy(node.state))
  const handles = (node: StateNode): boolean => Object.hasOwn(node.state.on ?? {}, event)
  const renders = (...active: readonly StateNode[]): boolean =>
    isRendered({ listed, rendered: active.flatMap((node) => listedBy(node.state)) }, event)

  for (const node of states) {
    if (node.kind === 'root' && !handles(node) && renders(node)) {
      return node.path
    }

    if (node.kind === 'parallel' && !handles(node)) {
      const unhandled = regionStates.filter(
        (other) => other.parallel === node.name && !handles(other),
      )
      const everyRegion = Object.keys(node.state.states).every((region) =>
        unhandled.some((other) => other.region === region),
      )
      const found = everyRegion ? unhandled.find((other) => renders(node, other)) : undefined

      if (found !== undefined) {
        return found.path
      }
    }
  }

  return undefined
}

/** The enabling of a control by its machine, on each control of a held kind that is an event. */
const enabling: Rule = ({ screens }) => ({
  name: 'disabled',
  on: new Map(
    screens.screens.flatMap(({ anchors, flow }) => {
      const nodes = flow === undefined ? [] : flowNodes(flow)
      const events = new Set(
        nodes.flatMap((node) => (node.kind === 'region' ? [] : Object.keys(node.state.on ?? {}))),
      )

      return [...events].flatMap((event) => {
        const kind = own(anchors, event)?.kind

        if (kind === undefined || !ENABLED_BY_STATE_KINDS.has(kind)) {
          return []
        }

        const state = unhandledWhere(nodes, event)

        return [
          [
            event,
            {
              idiom: ENABLE_IDIOM,
              pattern: ENABLE,
              ...(state === undefined
                ? {}
                : { because: `the state "${state}" renders it and does not handle it` }),
            },
          ] as const,
        ]
      })
    }),
  ),
  elsewhere:
    "no state enables it: only a button, a tab, a select, a checkbox, a radio or a switch whose anchor is an event of its screen's flow is enabled by its machine; leave it out",
})

const RULES: readonly Rule[] = [limits, marks, enabling]

/** A prop as the source writes it: bare, a string, or an expression in braces. */
const written = (name: string, text: string): string =>
  text === ''
    ? name
    : text.startsWith('"') || text.startsWith("'")
      ? `${name}=${text}`
      : `${name}={${text}}`

/** The problems of one facet: each prop written against it, and each one called for and missing. */
function problemsOf({ name, on, elsewhere }: Facet, facets: Facets): Problem[] {
  const declared = new Set(declaredAnchors(facets.screens).map(({ anchor }) => anchor))
  const props = facets.collected.flatMap(({ file, props: all }) =>
    // An undeclared base is the parts check's problem: no facet problem on top of it.
    all
      .filter((prop) => prop.name === name && (prop.base === undefined || declared.has(prop.base)))
      .map((prop) => ({ ...prop, file })),
  )
  const carried = new Set(props.map(({ anchor }) => anchor))
  const against = props.flatMap(({ anchor, text, file, line }) => {
    const held = on.get(anchor)
    const as = written(name, text)

    if (held === undefined) {
      return [{ file, line, message: `"${anchor}": ${as}, but ${elsewhere}` }]
    }

    return held.pattern.test(text)
      ? []
      : [
          {
            file,
            line,
            message: `"${anchor}": ${as}, but the contract says ${name}={${held.idiom}}`,
          },
        ]
  })
  const missing = facets.ahead
    ? []
    : [...on].flatMap(([anchor, { idiom, because }]) => {
        const place = facets.rendered.get(anchor)

        return place === undefined || because === undefined || carried.has(anchor)
          ? []
          : [
              {
                ...place,
                message: `"${anchor}" carries ${name}={${idiom}} by the contract: ${because}`,
              },
            ]
      })

  return [...against, ...missing]
}

export const facetProblems = (facets: Facets): Problem[] =>
  RULES.flatMap((rule) => problemsOf(rule(facets), facets))
