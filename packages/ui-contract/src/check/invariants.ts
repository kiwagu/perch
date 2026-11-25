/**
 * The invariants of the platform (`platform.invariants`), each a rule several actions keep, said
 * once and named by each action under the code it refuses with, alone or among several. Its rule
 * writes each number it declares under `values` as `{name}`. Five rules hold them: each invariant
 * an action names exists, and its `refuses` is the code it is named under, both at that code; an
 * invariant no action names is refused, at the invariant; a placeholder of a rule names a value of
 * its invariant, at the rule; a value the rule never names is refused, at the value.
 */

import { codeEntriesOf, invariantActions, PLACEHOLDER, type Problem } from '../files'

import { type Contract, has, locate } from './contract'

export function invariantsProblems(contract: Contract): Problem[] {
  const { platform } = contract.screens
  const inScreens = locate(contract.screens)
  const invariants = platform.invariants ?? {}

  return [
    ...Object.entries(platform.actions).flatMap(([name, action]) =>
      codeEntriesOf(action.codes).flatMap(({ code, at, invariants: named }) =>
        named.flatMap((invariant) => {
          const here = ['platform', 'actions', name, 'codes', at]
          const declared = has(invariants, invariant) ? invariants[invariant] : undefined

          if (declared === undefined) {
            return [inScreens(here, `"${invariant}" is no invariant of platform.invariants`)]
          }

          return declared.refuses === code
            ? []
            : [
                inScreens(
                  here,
                  `the invariant "${invariant}" refuses with "${declared.refuses}", so an action names it under that code, not under "${code}"`,
                ),
              ]
        }),
      ),
    ),
    ...Object.entries(invariantActions(platform)).flatMap(([name, actions]) =>
      actions.length > 0
        ? []
        : [
            inScreens(
              ['platform', 'invariants', name],
              `no action names the invariant "${name}": an action that keeps it names it under the code it refuses with, \`${invariants[name]?.refuses}: { invariant: ${name} }\``,
            ),
          ],
    ),
    ...Object.entries(invariants).flatMap(([name, { rule, values = {} }]) => {
      const named = new Set([...rule.matchAll(PLACEHOLDER)].map(([, value]) => value))

      return [
        ...[...named]
          .filter((value) => value === undefined || !Object.hasOwn(values, value))
          .map((value) =>
            inScreens(
              ['platform', 'invariants', name, 'rule'],
              `"{${value ?? ''}}" names no value of "${name}": declare it under its values, or write the text without braces`,
            ),
          ),
        ...Object.keys(values)
          .filter((value) => !named.has(value))
          .map((value) =>
            inScreens(
              ['platform', 'invariants', name, 'values', value],
              `the rule of "${name}" never names it: write "{${value}}" where the rule states it`,
            ),
          ),
      ]
    }),
  ]
}
