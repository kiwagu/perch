/**
 * The rules of version 3, which place each code of a platform action on the parameter it
 * concerns (`attributedCodes`), so an error derives the field it shows the code under:
 *
 * 1. a parameter whose value is a string refers to a value or writes a constraint beside its type;
 * 2. a code that ends like the code of a field (a suffix of `FIELD_CODE_SUFFIXES`) concerns a
 *    parameter, named after it or listed in its `codes`;
 * 3. a code named after a parameter names a constraint the parameter's value has, as the row of
 *    its suffix reads it;
 * 4. the `codes` of a parameter are codes of its action.
 *
 * A contract before version 3 is held to none of them.
 */

import {
  ATTRIBUTION_EDITION,
  attributedCodes,
  codeEntriesOf,
  codeNamedAfter,
  codeNamesOf,
  constrains,
  FIELD_CODE_SUFFIXES,
  keywordsOf,
  type Problem,
  parameterValueOf,
} from '../files'

import { type Contract, locate } from './contract'
import { since } from './editions'

const PLATFORM = 'platform.'

/** Each action of the platform with its name, its declaration and where it is. */
const actionsOf = (contract: Contract) =>
  Object.entries(contract.screens.platform.actions).map(([name, declared]) => ({
    name,
    declared,
    at: ['platform', 'actions', name],
  }))

/** Rule 1: a string parameter refers to a value or writes a constraint beside its type. */
function unboundedProblems(contract: Contract): Problem[] {
  if (!since(contract, ATTRIBUTION_EDITION)) {
    return []
  }

  const { platform } = contract.screens

  return actionsOf(contract).flatMap(({ name, declared, at }) =>
    Object.entries(declared.params).flatMap(([param, parameter]) =>
      parameterValueOf(`${PLATFORM}${name}`, param, platform, contract.model).type === 'string' &&
      parameter.value === undefined &&
      !constrains(keywordsOf(parameter))
        ? [
            locate(contract.screens)(
              [...at, 'params', param],
              'a string that refers to no value and writes no constraint: refer to a value (`value: <name>`) or write a constraint beside its type',
            ),
          ]
        : [],
    ),
  )
}

/** Rule 2: a code that ends like the code of a field concerns a parameter. */
function strayProblems(contract: Contract): Problem[] {
  if (!since(contract, ATTRIBUTION_EDITION)) {
    return []
  }

  return actionsOf(contract).flatMap(({ name, declared, at }) => {
    const attributed = new Set(
      Object.values(attributedCodes(`${PLATFORM}${name}`, contract.screens.platform)).flat(),
    )

    return codeEntriesOf(declared.codes).flatMap(({ code, at: place }) => {
      const row = FIELD_CODE_SUFFIXES.find(({ suffix }) => code.endsWith(`-${suffix}`))

      return row === undefined || attributed.has(code)
        ? []
        : [
            locate(contract.screens)(
              [...at, 'codes', place],
              `"${code}" ends like the code of a field ("-${row.suffix}") but concerns no parameter: name it after one (\`<parameter>-${row.suffix}\`) or list it in the \`codes\` of the one it concerns`,
            ),
          ]
    })
  })
}

/** Rule 3: a code named after a parameter names a constraint its value has. */
function unconstrainedProblems(contract: Contract): Problem[] {
  if (!since(contract, ATTRIBUTION_EDITION)) {
    return []
  }

  const { platform } = contract.screens

  return actionsOf(contract).flatMap(({ name, declared, at }) =>
    Object.keys(declared.params).flatMap((param) => {
      const value = parameterValueOf(`${PLATFORM}${name}`, param, platform, contract.model)

      return FIELD_CODE_SUFFIXES.flatMap(({ suffix, holds, constraint }) => {
        const named = codeEntriesOf(declared.codes).find(
          ({ code }) => code === codeNamedAfter(param, suffix),
        )

        return named === undefined || holds(value)
          ? []
          : [
              locate(contract.screens)(
                [...at, 'codes', named.at],
                `"${named.code}" is named after the parameter "${param}", whose value has no ${constraint}`,
              ),
            ]
      })
    }),
  )
}

/** Rule 4: the `codes` of a parameter are codes of its action. */
function listedProblems(contract: Contract): Problem[] {
  if (!since(contract, ATTRIBUTION_EDITION)) {
    return []
  }

  return actionsOf(contract).flatMap(({ name, declared, at }) =>
    Object.entries(declared.params).flatMap(([param, { codes = [] }]) =>
      codes.flatMap((code, index) =>
        codeNamesOf(declared.codes).includes(code)
          ? []
          : [
              locate(contract.screens)(
                [...at, 'params', param, 'codes', index],
                `"${code}" is no code of the action "${name}"`,
              ),
            ],
      ),
    ),
  )
}

export const attributionProblems = (contract: Contract): Problem[] => [
  ...unboundedProblems(contract),
  ...strayProblems(contract),
  ...unconstrainedProblems(contract),
  ...listedProblems(contract),
]
