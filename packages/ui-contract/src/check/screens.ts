/**
 * Rule 2: the screens and their anchors hold together. Every anchor is declared once in
 * the whole file and never named like a derived anchor of another one; it starts with
 * its screen's id and ends with its kind; the entry anchors are the screen's own; a
 * screen that is not the frame has a route.
 */

import { kindOf, screenOf } from '../anchors'
import type { Problem } from '../files'

import { type Contract, declaredAnchors, inScreens, knownAnchors } from './contract'

function screenIdProblems({ screens }: Contract): Problem[] {
  const seen = new Set<string>()

  return screens.screens.flatMap((screen, index) => {
    const repeated = seen.has(screen.id)

    seen.add(screen.id)

    return repeated
      ? [inScreens(['screens', index, 'id'], `"${screen.id}" is the id of another screen`)]
      : []
  })
}

function duplicateProblems({ screens }: Contract): Problem[] {
  const first = new Map<string, string>()

  return declaredAnchors(screens).flatMap(({ anchor, screen, at }) => {
    const owner = first.get(anchor)

    if (owner === undefined) {
      first.set(anchor, screen.id)

      return []
    }

    return [inScreens(at, `also declared on screen "${owner}"`)]
  })
}

/**
 * A declared anchor `<base>.<suffix>` where `<base>` is declared too and `<suffix>` is a
 * derived suffix of the vocabulary or one the base lists in `derived`: the name would
 * read as (or be) a derived anchor of the base.
 */
function derivedNameProblems({ screens, vocabulary }: Contract): Problem[] {
  const anchors = declaredAnchors(screens)
  const defs = new Map(anchors.map(({ anchor, def }) => [anchor, def]))

  return anchors.flatMap(({ anchor, at }) => {
    const dot = anchor.lastIndexOf('.')
    const base = anchor.slice(0, dot)
    const suffix = anchor.slice(dot + 1)
    const baseDef = defs.get(base)

    if (
      baseDef === undefined ||
      !(suffix in vocabulary.suffixes || (baseDef.derived ?? []).includes(suffix))
    ) {
      return []
    }

    return [
      inScreens(
        at,
        `reads as the anchor "${base}" with the suffix "${suffix}"; a declared anchor is never named like a derived one`,
      ),
    ]
  })
}

function entryProblems(contract: Contract): Problem[] {
  return contract.screens.screens.flatMap((screen, index) => {
    const own = knownAnchors({
      ...contract,
      screens: { ...contract.screens, screens: [screen] },
    })

    return screen.entry.flatMap((anchor, at) =>
      own(anchor)
        ? []
        : [
            inScreens(
              ['screens', index, 'entry', at],
              `"${anchor}" is not declared on this screen`,
            ),
          ],
    )
  })
}

const bindingProblems = ({ screens }: Contract): Problem[] =>
  screens.screens.flatMap((screen, index) =>
    screen.frame !== true && screen.bindings.length === 0
      ? [
          inScreens(
            ['screens', index, 'bindings'],
            'a screen that is not the frame needs at least one binding',
          ),
        ]
      : [],
  )

function nameProblems({ screens }: Contract): Problem[] {
  const ids = screens.screens.map(({ id }) => id)

  return declaredAnchors(screens).flatMap(({ anchor, def, screen, at }) => [
    ...(screenOf(anchor, ids) === screen.id
      ? []
      : [inScreens(at, `does not start with its screen's id "${screen.id}"`)]),
    ...(def.kind === kindOf(anchor)
      ? []
      : [
          inScreens(
            [...at, 'kind'],
            `"${def.kind}" is not the kind its name ends with ("${kindOf(anchor)}")`,
          ),
        ]),
  ])
}

export const screensProblems = (contract: Contract): Problem[] => [
  ...screenIdProblems(contract),
  ...duplicateProblems(contract),
  ...derivedNameProblems(contract),
  ...entryProblems(contract),
  ...bindingProblems(contract),
  ...nameProblems(contract),
]
