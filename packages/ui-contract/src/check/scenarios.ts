/**
 * Rule 6: the scenarios speak of what the contract declares. Every bracket reference in
 * their text resolves (an anchor declared, or derived from a declared base with a suffix it
 * lists in `derived`, the path of a binding, a code, a state, a choice value or a value a
 * pattern row matches, `show` or `hide` once an input renders a visibility-button, a mail
 * `[mail:<action>]` a platform action that declares one, a notice `[notice:<action>.<name>]` a
 * notice of that name the platform action declares), a code, a state or a value is one the
 * anchor named last before it in the same text carries (`anchorCarries`; a mail or a notice
 * ends the pairing), the
 * activity a scenario names is one of `contract/domain/activities`, and every device acts as
 * a role of the vocabulary. Each problem is one of the scenario's file, named by its field and
 * at the line of that field (of the deepest part of its path the file holds); the ids are
 * paths, so each is used once.
 */

import { ACTIVITIES_DIR, jsonPath, lineAt, type Problem, scenarioFile } from '../files'
import { type Reference, referencesIn, type Scenario } from '../scenarios'

import { anchorCarries, type Carried } from './carries'
import {
  bindingPaths,
  type Contract,
  codesOf,
  contractValues,
  has,
  inFile,
  knownAnchors,
  own,
  statesOf,
} from './contract'
import { unknownNotice } from './notices'

/** The text fields of a scenario that carry bracket references, with their paths. */
export const textsOf = (scenario: Scenario): Array<{ text: string; at: PropertyKey[] }> => [
  { text: scenario.where, at: ['where'] },
  { text: scenario.scenario, at: ['scenario'] },
  ...scenario.steps.map((text, index) => ({ text, at: ['steps', index] })),
  ...scenario.expected.map((text, index) => ({ text, at: ['expected', index] })),
]

/**
 * Resolves a reference against the contract: undefined when the contract declares what it
 * names, or a message, opening with its `raw` text, that says what it is not. The consumers
 * check resolves the literals of the e2e tests with it.
 */
export function referenceResolver(
  contract: Contract,
): (reference: Reference) => string | undefined {
  const known = knownAnchors(contract)
  const paths = bindingPaths(contract.screens)
  const states = statesOf(contract.vocabulary)
  const codes = codesOf(contract.vocabulary, contract.screens)
  const values = contractValues(contract)

  return ({ kind, value, raw }) => {
    switch (kind) {
      case 'anchor':
        return known(value) ? undefined : `${raw} is not a declared anchor`
      case 'route':
        return paths.has(value) ? undefined : `${raw} is the path of no binding`
      case 'code':
        return codes.has(value) ? undefined : `${raw} is not a code of the vocabulary`
      case 'state':
        return states.has(value) ? undefined : `${raw} is not a state of the vocabulary`
      case 'value':
        return values(value) ? undefined : `${raw} is not a choice value of the vocabulary`
      case 'mail':
        return own(contract.screens.platform.actions, value)?.mail === undefined
          ? `${raw} names no platform action that sends a mail`
          : undefined
      case 'notice':
        return unknownNotice(contract.screens.platform, value, raw)
    }
  }
}

const isCarried = (kind: Reference['kind']): kind is Carried =>
  kind === 'code' || kind === 'state' || kind === 'value'

/**
 * Each reference of a text with the anchor named last before it in the same text, if any: the
 * anchor a code, a state or a value pairs with. A route is no anchor and is read past; a mail or
 * a notice is no anchor either, and what follows it speaks of the mail or the notice (its
 * language, its link), so it pairs with no anchor until the text names one again.
 */
function pairedIn(
  references: readonly Reference[],
): Array<{ reference: Reference; anchor: string | undefined }> {
  const paired: Array<{ reference: Reference; anchor: string | undefined }> = []
  let anchor: string | undefined

  for (const reference of references) {
    paired.push({ reference, anchor })

    if (reference.kind === 'anchor') {
      anchor = reference.value
    } else if (reference.kind === 'mail' || reference.kind === 'notice') {
      anchor = undefined
    }
  }

  return paired
}

/**
 * Why a code, a state or a value does not pair with its anchor, or undefined when it does, when it
 * has none, or when its anchor is unknown (a problem of its own). The consumers check pairs what
 * the e2e tests assert on an anchor with it.
 */
export function pairingResolver(
  contract: Contract,
): (reference: Reference, anchor: string | undefined) => string | undefined {
  const known = knownAnchors(contract)
  const carries = anchorCarries(contract)

  return ({ kind, value }, anchor) =>
    anchor === undefined || !isCarried(kind) || !known(anchor) || carries(anchor, kind, value)
      ? undefined
      : `${anchor} never carries ${kind} ${value}`
}

export function scenariosProblems(contract: Contract): Problem[] {
  const resolve = referenceResolver(contract)
  const pair = pairingResolver(contract)
  const activities = new Set(contract.activities.map(({ id }) => id))

  return contract.scenarios.flatMap((scenario) => {
    const file = scenarioFile(scenario.id)
    const lines = contract.scenarioLines.get(scenario.id)
    const problem = (at: readonly PropertyKey[], message: string): Problem =>
      inFile(file, `${jsonPath(at)}: ${message}`, lineAt(lines, at))
    const { activity } = scenario

    return [
      ...(activity === undefined || activities.has(activity)
        ? []
        : [problem(['activity'], `"${activity}" is not an activity of ${ACTIVITIES_DIR}`)]),
      ...Object.entries(scenario.devices).flatMap(([device, role]) =>
        has(contract.vocabulary.roles, role)
          ? []
          : [problem(['devices', device], `"${role}" is not a role of the vocabulary`)],
      ),
      ...textsOf(scenario).flatMap(({ text, at }) => {
        const { references, problems } = referencesIn(text)

        return [
          ...pairedIn(references).flatMap(({ reference, anchor }) => {
            const unresolved = resolve(reference) ?? pair(reference, anchor)

            return unresolved === undefined ? [] : [problem(at, unresolved)]
          }),
          ...problems.map((message) => problem(at, message)),
        ]
      }),
    ]
  })
}
