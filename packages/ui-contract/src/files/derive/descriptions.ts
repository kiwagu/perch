/**
 * The descriptions the engine says itself, so a screen file may leave them out: a heading
 * names its screen, a link bound to a route leads to that screen, a secret input holds a
 * secret the user types, an error says why the actions bound beside it, then those its
 * screen's flow invokes against it, did not go through, each code with its meaning from the
 * vocabulary. A composite's anchors carry their descriptions from the
 * platform already. The manifest carries the written description when there is one (a secret
 * input's with `(type password)` appended once), else the derived one; a written description
 * equal to the derived one is listed by `contract:coverage --descriptions` for the owner to drop.
 */

import { isRecord, listOf } from '../../records'
import type { AnchorDef, Screen } from '../screens'
import type { Vocabulary } from '../vocabulary'

import { type FailureOf, unionOf } from './failures'
import { flowSourcesOf } from './flow-errors'
import { partOf } from './form-params'

export const TYPE_PASSWORD = '(type password)'

export interface DescriptionContext {
  readonly screens: readonly Screen[]
  readonly codes: Vocabulary['codes']
  /** The failures of the actions, which tell the actions a flow invokes against an error. */
  readonly failureOf: FailureOf
}

const quoted = (names: readonly string[]): string => names.map((name) => `\`${name}\``).join(', ')

/** The route a link's one binding names, if any. */
function routeOf(def: AnchorDef): string | undefined {
  const [ref, ...more] = listOf(def.binding).filter(isRecord)
  const route = ref?.['route']

  return more.length === 0 && typeof route === 'string' ? route : undefined
}

/** The actions the anchors beside `error` bind (`<part>.<name>`, one segment more), each once. */
function actionsBeside(error: string, screen: Screen): string[] {
  const part = `${partOf(error)}.`
  const beside = Object.entries(screen.anchors).filter(
    ([name]) => name !== error && name.startsWith(part) && !name.slice(part.length).includes('.'),
  )

  return [
    ...new Set(
      beside.flatMap(([, def]) =>
        listOf(def.binding)
          .filter(isRecord)
          .flatMap((ref) => (typeof ref['action'] === 'string' ? [ref['action']] : [])),
      ),
    ),
  ]
}

/**
 * Why the actions of an error did not go through, each code with its meaning: those bound beside
 * it, then those the screen's flow invokes against it (`flowSourcesOf`), each once.
 */
function errorDescriptionOf(
  anchor: string,
  def: AnchorDef,
  screen: Screen,
  context: DescriptionContext,
): string | undefined {
  const invoked = flowSourcesOf(screen, context.failureOf).invoked.get(anchor) ?? []
  const actions = unionOf([actionsBeside(anchor, screen), invoked.map(({ action }) => action)])
  const codes = (def.codes ?? []).map((code) => {
    const meaning = context.codes[code]?.meaning

    return meaning === undefined ? `\`${code}\`` : `\`${code}\` (${meaning})`
  })

  if (actions.length === 0 && codes.length === 0) {
    return undefined
  }

  const why = `Why ${actions.length === 0 ? 'the action' : quoted(actions)} did not go through`

  return codes.length === 0 ? `${why}.` : `${why}: ${codes.join(', ')}.`
}

/** What the engine says of the anchor on its own, or nothing. */
export function derivedDescriptionOf(
  anchor: string,
  def: AnchorDef,
  screen: Screen,
  context: DescriptionContext,
): string | undefined {
  if (def.kind === 'heading') {
    return `Names the screen \`${screen.title}\`.`
  }

  if (def.kind === 'link') {
    const route = routeOf(def)
    const target =
      route === undefined
        ? undefined
        : context.screens.find(({ bindings }) => bindings.some(({ path }) => path === route))

    return target === undefined ? undefined : `Leads to \`${target.title}\`.`
  }

  if (def.kind === 'input' && def.secret === true) {
    return `A secret the user types, never shown ${TYPE_PASSWORD}.`
  }

  if (def.kind === 'error') {
    return errorDescriptionOf(anchor, def, screen, context)
  }

  return undefined
}

/** What the manifest carries: the written description (a secret input's with `(type password)`), else the derived one. */
export function describedOf(def: AnchorDef, derived: string | undefined): string | undefined {
  const { description } = def

  if (description === undefined) {
    return derived
  }

  if (def.kind === 'input' && def.secret === true && !description.includes(TYPE_PASSWORD)) {
    return `${description.replace(/\.$/, '')} ${TYPE_PASSWORD}.`
  }

  return description
}
