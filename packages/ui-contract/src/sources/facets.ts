/**
 * The facets the contract decides on a control's element, held where the sources write them on
 * the element that carries its anchor (`Collected.props`). Each rule of the table says, of one
 * prop, the anchors it may stand on, the idiom it is written in there, and on which of them the
 * contract calls for it; a prop the kit takes from the contract's field facts has none, and is
 * refused where a view would write it:
 *
 * - `maxLength`, on no element that carries an anchor: the kit gives a text field the limit its
 *   value takes (`fieldValueOf`) from the generated field facts, whatever the number a view writes;
 * - `type`, on no declared text field (an `input` or a `textarea`): the kit gives it the type its
 *   value has (an email) from the same facts, and any other a view writes would override them; a
 *   `type` on a button, a link or a part of a field is no field's;
 * - `aria-invalid={concerns === '<key>' ? true : undefined}` on each field an error of its screen
 *   names in its `fields` (`form` names none), and on no other element;
 * - `disabled={!props.can(<its event>)}` on a control of `ENABLED_BY_STATE_KINDS` whose anchor is
 *   an event of its screen's flow (a declared anchor of the screen, or a part one lists in
 *   `derived`, of the kind its suffix ends with), called for where a state the machine can be in
 *   renders it and does not handle it (`unhandled.ts`); it may stand on such a control that every
 *   state handles too, as the machine's own answer; never on a link, a text field or a control no
 *   state handles.
 *
 * A prop where the contract puts none, or in another idiom, is a problem at its line, in ahead
 * mode too; one the contract calls for and the element lacks, at the anchor's first literal (for
 * a part, the first `testIdFor()` of two literals that builds it), except in ahead mode: the
 * contract runs ahead of the app on a branch, so the app may lag behind it, never go beyond. A
 * prop the kit takes from the facts is never called for.
 */

import { ENABLED_BY_STATE_KINDS, kindOf, TEXT_FIELD_KINDS, testIdFor, WHOLE_FORM } from '../anchors'
import { declaredAnchors, own } from '../check'
import { flowNodes, type Problem, type ScreensFile } from '../files'

import { type Collected, type FacetProp, LEFT_TO_THE_KIT } from './collect'
import { unhandledWhere } from './unhandled'

interface Place {
  readonly file: string
  readonly line: number
}

export interface Facets {
  readonly collected: readonly Collected[]
  readonly screens: ScreensFile
  /**
   * The first place each anchor a source renders as a literal is written; a part a `testIdFor()`
   * of two literals builds is read from `collected`.
   */
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
  /** The anchors `elsewhere` holds the prop away from; every anchor when left out. */
  readonly within?: ReadonlySet<string>
}

type Rule = (facets: Facets) => Facet

const MARK_IDIOM = "concerns === '<key>' ? true : undefined"
const MARK = /^concerns === '[a-z][a-z-]*' \? true : undefined$/
const ENABLE_IDIOM = '!props.can(<its event>)'
const ENABLE = /^!\s*(props\.)?can\(/

/** The limit of a text field: the kit takes it from the field facts, so no element carries one. */
const limits: Rule = () => ({ name: 'maxLength', on: new Map(), elsewhere: LEFT_TO_THE_KIT })

/** The type of a text field: the kit takes it from the field facts, so no text field carries one. */
const types: Rule = ({ screens }) => ({
  name: 'type',
  on: new Map(),
  elsewhere: LEFT_TO_THE_KIT,
  within: new Set(
    declaredAnchors(screens).flatMap(({ anchor, def }) =>
      TEXT_FIELD_KINDS.has(def.kind) ? [anchor] : [],
    ),
  ),
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

/** The enabling of a control by its machine, on each control of a held kind that is an event. */
const enabling: Rule = ({ screens }) => ({
  name: 'disabled',
  on: new Map(
    screens.screens.flatMap(({ anchors, flow }) => {
      const nodes = flow === undefined ? [] : flowNodes(flow)
      const events = new Set(
        nodes.flatMap((node) => (node.kind === 'region' ? [] : Object.keys(node.state.on ?? {}))),
      )
      const parts = new Set(
        Object.entries(anchors).flatMap(([anchor, { derived }]) =>
          (derived ?? []).map((suffix) => testIdFor(anchor, suffix)),
        ),
      )

      return [...events].flatMap((event) => {
        // A declared control's kind, or the kind a part's suffix ends with (`confirm-button`).
        const kind = own(anchors, event)?.kind ?? (parts.has(event) ? kindOf(event) : undefined)

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

const RULES: readonly Rule[] = [limits, types, marks, enabling]

/** A prop as the source writes it: bare, a string, or an expression in braces. */
const written = (name: string, text: string): string =>
  text === ''
    ? name
    : text.startsWith('"') || text.startsWith("'")
      ? `${name}=${text}`
      : `${name}={${text}}`

/** The problems of one facet: each prop written against it, and each one called for and missing. */
function problemsOf({ name, on, elsewhere, within }: Facet, facets: Facets): Problem[] {
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
      return within === undefined || within.has(anchor)
        ? [{ file, line, message: `"${anchor}": ${as}, but ${elsewhere}` }]
        : []
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

/**
 * Where a source first renders each anchor: its literal, or for a part, which has no literal of
 * its own, the first `testIdFor()` of two literals that builds it.
 */
function renderedPlaces({ rendered, collected }: Facets): ReadonlyMap<string, Place> {
  const places = new Map(rendered)

  for (const { file, derived } of collected) {
    for (const { suffix, base, line } of derived) {
      const anchor = base === undefined ? undefined : testIdFor(base, suffix)

      if (anchor !== undefined && !places.has(anchor)) {
        places.set(anchor, { file, line })
      }
    }
  }

  return places
}

export function facetProblems(facets: Facets): Problem[] {
  const placed = { ...facets, rendered: renderedPlaces(facets) }

  return RULES.flatMap((rule) => problemsOf(rule(placed), placed))
}
