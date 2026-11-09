/**
 * Rule 3: what anchors are bound to exists. `model: entity.field` names a field of an
 * entity of the model; `action` names an entity action or a platform action, and its
 * `params` keys are that action's parameters, each taking a declared anchor, a constant, or a
 * search parameter every route of the screen declares (a parameter left out is the view's to
 * compute, and `$id` is minted), an anchor that is an item or a row giving the data-id of the
 * entry the bound control acts on: an entry of its own screen, which the control sits in the
 * part of (`entries.ts`); `route` is the path of a binding; `search` starts a field (an
 * anchor of a field kind, never a secret one) with a search parameter every route of the screen
 * declares; a
 * `source` sits on a list, a section or a table and names an entity and its order field, or a
 * platform action, each key of its `params` a parameter of that action taking a constant or a
 * search parameter every route of the screen declares (its paging is rule 18's, `paging.ts`).
 * What a flow names is rule 8's (`flow/`).
 */

import { FIELD_KINDS, LISTING_KINDS } from '../anchors'
import type { AnchorDef, BindingRef, ParamValue, Problem } from '../files'

import {
  bindingRefsOf,
  type Contract,
  type DeclaredAnchor,
  declaredAnchors,
  fieldProblem,
  has,
  own,
} from './contract'
import { carrierProblem, type EntryLookups, entryProblems, isEntry } from './entries'
import { actionProblems, type Lookups, lookupsOf, routeProblems, searchOf } from './lookups'

function bindingProblems(
  lookups: Lookups,
  { ref, def }: { readonly ref: BindingRef; readonly def: AnchorDef },
  at: readonly PropertyKey[],
  search: ReadonlySet<string>,
): Problem[] {
  if ('search' in ref) {
    return [
      ...(search.has(ref.search)
        ? []
        : [
            lookups.inScreens(
              [...at, 'search'],
              `"${ref.search}" is not a search parameter of every route of the screen`,
            ),
          ]),
      ...(FIELD_KINDS.has(def.kind)
        ? []
        : [
            lookups.inScreens(
              [...at, 'search'],
              `a ${def.kind} starts with no search parameter: only a field holds a value to start with`,
            ),
          ]),
      ...(def.secret === true
        ? [
            lookups.inScreens(
              [...at, 'search'],
              'a secret field starts with no search parameter: a secret never comes from a URL',
            ),
          ]
        : []),
    ]
  }

  if ('route' in ref) {
    return routeProblems(lookups, ref.route, [...at, 'route'])
  }

  if ('action' in ref) {
    return actionProblems(
      lookups,
      ref.action,
      ref.params,
      { action: [...at, 'action'], params: [...at, 'params'] },
      search,
    )
  }

  const problem = fieldProblem(lookups.contract.model, ref.model)

  return problem === undefined ? [] : [lookups.inScreens([...at, 'model'], problem)]
}

function sourceProblems(
  lookups: Lookups,
  def: AnchorDef,
  at: readonly PropertyKey[],
  search: ReadonlySet<string>,
): Problem[] {
  const { contract, inScreens } = lookups
  const { source } = def

  if (source === undefined) {
    return []
  }

  return [
    ...(LISTING_KINDS.has(def.kind)
      ? []
      : [
          inScreens(
            at,
            `a ${def.kind} has no entries: a source sits on a list, a section or a table`,
          ),
        ]),
    ...sourceRefProblems({ contract, inScreens }, source, at),
    ...('platform' in source && has(contract.screens.platform.actions, source.platform)
      ? actionProblems(
          lookups,
          `platform.${source.platform}`,
          source.params,
          { action: [...at, 'platform'], params: [...at, 'params'] },
          search,
        )
      : []),
  ]
}

/** What a source names exists: a platform action, or an entity with its order field. */
function sourceRefProblems(
  { contract, inScreens }: Pick<Lookups, 'contract' | 'inScreens'>,
  source: NonNullable<AnchorDef['source']>,
  at: readonly PropertyKey[],
): Problem[] {
  if ('platform' in source) {
    return has(contract.screens.platform.actions, source.platform)
      ? []
      : [inScreens([...at, 'platform'], `no platform action "${source.platform}"`)]
  }

  const entity = own(contract.model.entities, source.entity)

  if (entity === undefined) {
    return [inScreens([...at, 'entity'], `no entity "${source.entity}" in the model`)]
  }

  return source.order === undefined || has(entity.fields, source.order)
    ? []
    : [inScreens([...at, 'order'], `entity "${source.entity}" has no field "${source.order}"`)]
}

/** The params of a declared anchor's binding that take an entry's data-id, as the header says. */
function entryParamProblems(
  entries: Omit<EntryLookups, 'screen'>,
  { anchor, screen }: DeclaredAnchor,
  params: Readonly<Record<string, ParamValue>> | undefined,
  at: readonly PropertyKey[],
): Problem[] {
  return Object.entries(params ?? {}).flatMap(([key, value]) => {
    if (typeof value !== 'string' || !isEntry(entries, value)) {
      return []
    }

    const where = [...at, key]
    const carried =
      own(screen.anchors, value) === undefined
        ? undefined
        : carrierProblem(screen, value, anchor, (what) => `on ${what}`)

    return [
      ...entryProblems({ ...entries, screen }, value, 'a parameter', where),
      ...(carried === undefined ? [] : [entries.inScreens(where, carried)]),
    ]
  })
}

function anchorProblems(lookups: Lookups): Problem[] {
  const declared = declaredAnchors(lookups.contract.screens)
  const entries = {
    defs: new Map(declared.map(({ anchor, def }) => [anchor, def])),
    inScreens: lookups.inScreens,
  }

  return declared.flatMap((one) => {
    const { def, at, screen } = one

    return [
      ...bindingRefsOf(def).flatMap((entry) => [
        ...bindingProblems(
          lookups,
          { ref: entry.ref, def },
          [...at, ...entry.at],
          searchOf(screen),
        ),
        ...('action' in entry.ref
          ? entryParamProblems(entries, one, entry.ref.params, [...at, ...entry.at, 'params'])
          : []),
      ]),
      ...sourceProblems(lookups, def, [...at, 'source'], searchOf(screen)),
    ]
  })
}

export const bindingsProblems = (contract: Contract): Problem[] =>
  anchorProblems(lookupsOf(contract))
