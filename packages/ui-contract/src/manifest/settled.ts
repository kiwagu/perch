/**
 * The e2e harness's check of a settled state: what the page shows once a screen's machine has
 * settled in a state, held to what that state renders (`meta.renders`, read by `renderedAt`).
 * Only the anchors of the screen that render only where listed are held, with their derived
 * parts; those every state renders are not. Rendered means visible to the user: an anchor the
 * state does not render is not visible, absent from the page or hidden on it; one it renders is
 * on the page and visible, unless something besides the state decides whether it shows
 * (`decidedBesidesState`: data, or its own rule or that of an anchor it is under, not visible),
 * where only the first holds. A derived part the page shows on demand is held to the first only
 * as well. An anchor of the screen that says when it shows (`with`, `without`), unless it is
 * rendered in each entry of a list, is held to its entries (`withShownProblems`), and a visible
 * list to having an entry (`emptyListProblems`).
 */

import {
  CONTROL_KINDS,
  containersOf,
  ENTRY_KINDS,
  entriesShowOn,
  entryAnchorOf,
  entryCodesOf,
  entryOf,
  entryShowsOn,
  isListed,
  isRendered,
  isUnder,
  NEXT_LINK,
  PREVIOUS_LINK,
  RANGE,
  type RenderedAnchor,
  type RenderedAt,
  renderedAt,
  type SettledState,
  type SettledValue,
  type WithEntry,
} from '../anchors'

import type { Manifest } from './manifest.types'

/** What the check reads of the manifest: each screen's flow, and every declared anchor. */
export interface SettledContract {
  readonly screens: readonly { readonly id: string; readonly flow?: unknown }[]
  readonly ids: Readonly<
    Record<
      string,
      Pick<
        Manifest['ids'][string],
        | 'screen'
        | 'kind'
        | 'derived'
        | 'roles'
        | 'own'
        | 'dataId'
        | 'states'
        | 'with'
        | 'without'
        | 'derivedFrom'
      >
    >
  >
}

/**
 * The derived parts a page shows on demand, never with their base alone: a select's options
 * while it is open, a composite's entries (its data), a field's error text when it has one, and
 * a paged list's range and links, which its read decides (the range once the read is in, the
 * previous link past the first page, the next one before the last). A paged list's size select
 * is no such part: it shows wherever the list does.
 */
const ON_DEMAND: ReadonlySet<string> = new Set([
  'option',
  'item',
  'error-message',
  RANGE,
  PREVIOUS_LINK,
  NEXT_LINK,
])

/** The states a list shows itself in while it has no entry: waiting for its read, or empty. */
const WAITING_OR_EMPTY: ReadonlySet<string> = new Set(['loading', 'empty'])

/** `sign-up`, or `viewing (form: open, notes: idle)` for a parallel state. */
const stateText = (value: SettledValue): string =>
  typeof value === 'string'
    ? value
    : Object.entries(value)
        .map(([state, regions]) =>
          typeof regions === 'string'
            ? `${state}.${regions}`
            : `${state} (${Object.entries(regions)
                .map(([region, of]) => `${region}: ${stateText(of)}`)
                .join(', ')})`,
        )
        .join(', ')

/** The declared anchors `anchor` is or is nested under, a derived part's base included. */
const declaredOver = (contract: SettledContract, anchor: string) =>
  Object.entries(contract.ids).filter(([name]) => isUnder(name, anchor))

/** The screen that declares `anchor`, or the anchor it is nested under or derived from. */
const screenOf = (contract: SettledContract, anchor: string): string | undefined =>
  declaredOver(contract, anchor).reduce<[string, string] | undefined>(
    (longest, [name, { screen }]) =>
      longest === undefined || name.length > longest[0].length ? [name, screen] : longest,
    undefined,
  )?.[1]

/** The anchors of `screen` a page shows with their base: each declared one, then its parts. */
const anchorsOf = (contract: SettledContract, screen: string): string[] =>
  Object.entries(contract.ids)
    .filter(([, { screen: of }]) => of === screen)
    .flatMap(([anchor, { derived }]) => [
      anchor,
      ...(derived ?? []).filter((suffix) => !ON_DEMAND.has(suffix)).map((s) => `${anchor}.${s}`),
    ])

/** One declared anchor, as the check reads it. */
type SettledId = SettledContract['ids'][string]

/** What a settled state's page is held to: the contract, the screen, what the state renders. */
interface SettledPage {
  readonly contract: SettledContract
  readonly screen: string
  readonly at: RenderedAt
  readonly anchors: readonly RenderedAnchor[]
  /** `<screen> in <state>`, which each line starts with. */
  readonly where: string
}

/** The declared anchors of `screen`, by name. */
const idsOf = (contract: SettledContract, screen: string): SettledContract['ids'] =>
  Object.fromEntries(Object.entries(contract.ids).filter(([, def]) => def.screen === screen))

/** `"<anchor>"`, or `"<anchor>" (<code> or <code>)` for a code entry. */
const entryText = (entry: WithEntry): string => {
  const codes = entryCodesOf(entry)

  return `"${entryAnchorOf(entry)}"${codes === undefined ? '' : ` (${codes.join(' or ')})`}`
}

/**
 * Whether the own rule of `name` may keep it off a page whose state renders it: a cell, shown
 * with a value; a list whose entries come from data (any but a composite's), shown with one,
 * unless its states show it waiting or empty; an anchor whose `with` and `without` do not say it
 * shows on the page, or that is rendered in each entry of a list, which the report does not tell
 * apart.
 */
function mayStayAway({ contract, anchors }: SettledPage, name: string, def: SettledId): boolean {
  if (def.kind === 'cell') {
    return true
  }
  if (def.kind === 'list') {
    return (
      def.derivedFrom === undefined &&
      !(def.states ?? []).some((state) => WAITING_OR_EMPTY.has(state))
    )
  }

  return (
    (def.with !== undefined || def.without !== undefined) &&
    (entryOf(name, idsOf(contract, def.screen)) !== undefined || !entriesShowOn(def, anchors))
  )
}

/**
 * Whether something besides its state decides if `anchor` shows, so a state that renders it does
 * not require it on the page: data (`roles`, `own` or a `dataId` on it or on an anchor it is
 * nested under), or the rule of it, or of an anchor it is nested under or derived from, that may
 * keep that anchor away (`mayStayAway`) while it is not visible; the parts of a base that shows
 * follow their base.
 */
function decidedBesidesState(page: SettledPage, anchor: string): boolean {
  return declaredOver(page.contract, anchor).some(
    ([name, def]) =>
      def.roles !== undefined ||
      def.own === true ||
      def.dataId !== undefined ||
      (mayStayAway(page, name, def) &&
        !page.anchors.some((each) => each.anchor === name && each.visible)),
  )
}

/**
 * Each anchor of the screen with `with` or `without`, unless it is rendered in each entry of a
 * list, which the report does not tell apart: visible only while each `with` entry renders and
 * no `without` entry does. A control no state lists, which nothing besides its state decides, is
 * visible once each `with` entry renders, one at least, and no `without` entry does (a listed one
 * is held by the states that render it, which consult its entries); any other element shows by
 * its own data too (a cell its value, a list its entries, a message its code), and without a
 * `with` entry nothing on the page says the area that holds it is shown.
 */
function withShownProblems(page: SettledPage): string[] {
  const { contract, screen, at, anchors, where } = page
  const ids = idsOf(contract, screen)

  return Object.entries(ids)
    .filter(
      ([anchor, def]) =>
        (def.with !== undefined || def.without !== undefined) && entryOf(anchor, ids) === undefined,
    )
    .flatMap(([anchor, def]) => {
      const withs = def.with ?? []
      const withouts = def.without ?? []

      if (anchors.some((each) => each.anchor === anchor && each.visible)) {
        return [
          ...withs
            .filter((entry) => entryShowsOn(entry, anchors) === false)
            .map(
              (entry) =>
                `${where}: "${anchor}" is visible, but ${entryText(entry)} does not show: it shows only with it`,
            ),
          ...withouts
            .filter((entry) => entryShowsOn(entry, anchors) === true)
            .map(
              (entry) =>
                `${where}: "${anchor}" is visible, but ${entryText(entry)} shows: it shows only without it`,
            ),
        ]
      }

      const shows = withs.length > 0 && entriesShowOn(def, anchors)
      const held =
        CONTROL_KINDS.has(def.kind) && !isListed(at, anchor) && !decidedBesidesState(page, anchor)

      return shows && held
        ? [
            `${where}: "${anchor}" is not visible, but each entry of its with shows and none of its without`,
          ]
        : []
    })
}

/**
 * Each visible list of the screen that has entries (an `item` or a `row` it contains) and shows
 * none of them, unless its states say it shows itself waiting or empty (`loading`, `empty`).
 */
function emptyListProblems({ contract, screen, anchors, where }: SettledPage): string[] {
  const ids = idsOf(contract, screen)
  const visible = new Set(anchors.filter((each) => each.visible).map(({ anchor }) => anchor))

  return Object.entries(ids)
    .filter(
      ([list, { kind, states }]) =>
        kind === 'list' &&
        visible.has(list) &&
        !(states ?? []).some((state) => WAITING_OR_EMPTY.has(state)),
    )
    .flatMap(([list]) => {
      const entries = Object.entries(ids)
        .filter(
          ([entry, { kind }]) => ENTRY_KINDS.has(kind) && containersOf(entry, ids).includes(list),
        )
        .map(([entry]) => entry)

      return entries.length === 0 || entries.some((entry) => visible.has(entry))
        ? []
        : [`${where}: "${list}" is visible with no entry: a list with none is not rendered`]
    })
}

/** What the page of a settled state shows against what the state renders, one line each. */
export function settledProblems(contract: SettledContract, settled: SettledState): string[] {
  const screen = contract.screens.find(({ id }) => id === settled.screen)

  if (screen === undefined) {
    return [`"${settled.screen}" is no screen of the contract`]
  }

  const at = renderedAt(screen.flow, settled.value)
  const where = `${settled.screen} in ${stateText(settled.value)}`
  const anchors = settled.page.anchors
  const visible = [...new Set(anchors.filter((each) => each.visible).map(({ anchor }) => anchor))]

  const unrendered = visible
    .filter((anchor) => screenOf(contract, anchor) === settled.screen && !isRendered(at, anchor))
    .map((anchor) => `${where}: "${anchor}" is visible, but the state does not render it`)

  const page = { contract, screen: settled.screen, at, anchors, where }
  const unshown = anchorsOf(contract, settled.screen)
    .filter(
      (anchor) =>
        isListed(at, anchor) && isRendered(at, anchor) && !decidedBesidesState(page, anchor),
    )
    .flatMap((anchor) => {
      const elements = anchors.filter((each) => each.anchor === anchor)

      if (elements.length === 0) {
        return [`${where}: "${anchor}" is not on the page, but the state renders it`]
      }

      return elements.some((each) => each.visible)
        ? []
        : [`${where}: "${anchor}" is hidden, but the state renders it`]
    })

  return [...unrendered, ...unshown, ...withShownProblems(page), ...emptyListProblems(page)]
}
