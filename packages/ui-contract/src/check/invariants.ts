/**
 * The invariants of the platform (`platform.invariants`), each a rule several actions keep, said
 * once and named by each action under the code it refuses with, alone or among several. Three
 * rules hold them: each invariant an action names exists, and its `refuses` is the code it is named
 * under, both at that code; an invariant no action names is refused, at the invariant.
 */

import { codeEntriesOf, invariantActions, type Problem } from '../files'

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
  ]
}
