/**
 * The e2e harness's check of a settled state: what the page shows once a screen's machine has
 * settled in a state, held to what that state renders (`meta.renders`, read by `renderedAt`).
 * Only the anchors of the screen that render only where listed are held, with their derived
 * parts; those every state renders are not. Rendered means visible to the user: an anchor the
 * state does not render is not visible, absent from the page or hidden on it; one it renders is
 * on the page and visible, unless data decides whether it shows (an anchor with `roles` or
 * `own`, an entry of a list, `dataId`, or an anchor nested under one of these), where only the
 * first holds. A derived part the page shows on demand is held to the first only as well.
 */

import {
  isListed,
  isRendered,
  isUnder,
  renderedAt,
  type SettledState,
  type SettledValue,
} from '../anchors'

import type { Manifest } from './manifest.types'

/** What the check reads of the manifest: each screen's flow, and every declared anchor. */
export interface SettledContract {
  readonly screens: readonly { readonly id: string; readonly flow?: unknown }[]
  readonly ids: Readonly<
    Record<string, Pick<Manifest['ids'][string], 'screen' | 'derived' | 'roles' | 'own' | 'dataId'>>
  >
}

/**
 * The derived parts a page shows on demand, never with their base alone: a select's options
 * while it is open, a composite's entries (its data), a field's error text when it has one.
 */
const ON_DEMAND: ReadonlySet<string> = new Set(['option', 'item', 'error-message'])

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

/** Whether data decides if `anchor` shows: it or what it is under has roles, own or a data-id. */
const decidedByData = (contract: SettledContract, anchor: string): boolean =>
  declaredOver(contract, anchor).some(
    ([, { roles, own, dataId }]) => roles !== undefined || own === true || dataId !== undefined,
  )

/** The anchors of `screen` a page shows with their base: each declared one, then its parts. */
const anchorsOf = (contract: SettledContract, screen: string): string[] =>
  Object.entries(contract.ids)
    .filter(([, { screen: of }]) => of === screen)
    .flatMap(([anchor, { derived }]) => [
      anchor,
      ...(derived ?? []).filter((suffix) => !ON_DEMAND.has(suffix)).map((s) => `${anchor}.${s}`),
    ])

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

  const unshown = anchorsOf(contract, settled.screen)
    .filter(
      (anchor) =>
        isListed(at, anchor) && isRendered(at, anchor) && !decidedByData(contract, anchor),
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

  return [...unrendered, ...unshown]
}
