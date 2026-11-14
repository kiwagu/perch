/**
 * Rule 2: the screens and their anchors hold together. Every anchor is declared once in
 * the whole file and never named like a derived anchor of another one; it starts with
 * its screen's id and ends with its kind; the entry anchors are the screen's own; a
 * screen that is not the frame has a route; an error's `fields` map codes it carries to
 * fields of its own screen; only a field says whether it holds input; only a field that holds
 * input drops its state colour; only an input renders a visibility-button.
 */

import {
  FIELD_KINDS,
  kindOf,
  STATEFUL_FIELD_KINDS,
  screenOf,
  VISIBILITY_BASE_KIND,
  VISIBILITY_BUTTON,
} from '../anchors'
import type { Problem } from '../files'

import { type Contract, declaredAnchors, has, knownAnchors, locate } from './contract'

function screenIdProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)
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
  const inScreens = locate(screens)
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
  const inScreens = locate(screens)
  const anchors = declaredAnchors(screens)
  const defs = new Map(anchors.map(({ anchor, def }) => [anchor, def]))

  return anchors.flatMap(({ anchor, at }) => {
    const dot = anchor.lastIndexOf('.')
    const base = anchor.slice(0, dot)
    const suffix = anchor.slice(dot + 1)
    const baseDef = defs.get(base)

    if (
      baseDef === undefined ||
      !(has(vocabulary.suffixes, suffix) || (baseDef.derived ?? []).includes(suffix))
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
  const inScreens = locate(contract.screens)

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
          locate(screens)(
            ['screens', index, 'bindings'],
            'a screen that is not the frame needs at least one binding',
          ),
        ]
      : [],
  )

function nameProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)
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

function fieldsProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)

  return declaredAnchors(screens).flatMap(({ def, screen, at }) => {
    if (def.fields === undefined) {
      return []
    }

    if (def.kind !== 'error') {
      return [inScreens([...at, 'fields'], 'only an error names the fields its codes concern')]
    }

    return Object.entries(def.fields).flatMap(([code, field]) => {
      const here = [...at, 'fields', code]
      const target = screen.anchors[field]

      return [
        ...((def.codes ?? []).includes(code)
          ? []
          : [inScreens(here, `"${code}" is not a code of the anchor`)]),
        ...(target === undefined
          ? [inScreens(here, `"${field}" is not an anchor of the screen`)]
          : FIELD_KINDS.has(target.kind)
            ? []
            : [inScreens(here, `"${field}" is a ${target.kind}, not a field`)]),
      ]
    })
  })
}

/** `holdsInput` says whether a field keeps what is typed; only a field has it. */
const holdsInputProblems = ({ screens }: Contract): Problem[] =>
  declaredAnchors(screens).flatMap(({ def, at }) =>
    def.holdsInput !== undefined && !FIELD_KINDS.has(def.kind)
      ? [locate(screens)([...at, 'holdsInput'], 'only a field holds input')]
      : [],
  )

/**
 * `marksState: false` drops the state colour of a field the kit colours: only an `input`, a
 * `textarea` or a `select` that holds input shows one.
 */
const marksStateProblems = ({ screens }: Contract): Problem[] =>
  declaredAnchors(screens).flatMap(({ def, at }) =>
    def.marksState !== undefined && !(STATEFUL_FIELD_KINDS.has(def.kind) && def.holdsInput === true)
      ? [
          locate(screens)(
            [...at, 'marksState'],
            'only a field that holds input shows a state colour',
          ),
        ]
      : [],
  )

/** `secret` says a field holds a secret, which never leaves the page; only a field has it. */
const secretProblems = ({ screens }: Contract): Problem[] =>
  declaredAnchors(screens).flatMap(({ def, at }) =>
    def.secret === true && !FIELD_KINDS.has(def.kind)
      ? [locate(screens)([...at, 'secret'], 'only a field holds a secret')]
      : [],
  )

/**
 * `ranked` says a message shows the first of the codes raised before it shows, in the order of
 * its `codes`: only a message ranks them, and a rank needs two codes or more, each once.
 */
function rankedProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)

  return declaredAnchors(screens).flatMap(({ def, at }) => {
    if (def.ranked !== true) {
      return []
    }

    if (def.kind !== 'message') {
      return [inScreens([...at, 'ranked'], 'only a message ranks its codes')]
    }

    const codes = def.codes ?? []

    if (codes.length < 2) {
      return [inScreens([...at, 'ranked'], 'a ranked message carries two codes or more')]
    }

    return codes.flatMap((code, index) =>
      codes.indexOf(code) < index
        ? [inScreens([...at, 'codes', index], `"${code}" is ranked twice`)]
        : [],
    )
  })
}

/**
 * The eye that shows or hides what a password input holds is derived by an input alone, and by a
 * secret one: on any other field there is nothing hidden for it to show.
 */
const visibilityProblems = ({ screens }: Contract): Problem[] =>
  declaredAnchors(screens).flatMap(({ def, at }) =>
    (def.derived ?? []).flatMap((suffix, index) => {
      if (suffix !== VISIBILITY_BUTTON) {
        return []
      }

      if (def.kind !== VISIBILITY_BASE_KIND) {
        return [
          locate(screens)(
            [...at, 'derived', index],
            `only an ${VISIBILITY_BASE_KIND} renders a ${VISIBILITY_BUTTON}`,
          ),
        ]
      }

      return def.secret === true
        ? []
        : [
            locate(screens)(
              [...at, 'derived', index],
              `only a secret ${VISIBILITY_BASE_KIND} renders a ${VISIBILITY_BUTTON}: declare it secret: true`,
            ),
          ]
    }),
  )

export const screensProblems = (contract: Contract): Problem[] => [
  ...screenIdProblems(contract),
  ...duplicateProblems(contract),
  ...derivedNameProblems(contract),
  ...entryProblems(contract),
  ...bindingProblems(contract),
  ...nameProblems(contract),
  ...fieldsProblems(contract),
  ...holdsInputProblems(contract),
  ...marksStateProblems(contract),
  ...secretProblems(contract),
  ...rankedProblems(contract),
  ...visibilityProblems(contract),
]
