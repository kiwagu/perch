/**
 * The values the parameters of the platform actions refer to: a `value` names a value of
 * `platform.values` or a field of the model (`<entity>.<field>`), one problem at the parameter
 * otherwise; and each keyword the parameter writes beside it narrows it (`wideningsOf`), one
 * problem at each keyword that would widen it or say other than it says. What the value then
 * is, `parameterValueOf` says.
 */

import { keywordsOf, type Problem, resolveValue, wideningsOf } from '../files'
import type { PlatformParameter } from '../schemas'

import { type Contract, fieldProblem, has, locate } from './contract'

/** Why `value` names nothing a parameter may refer to, or undefined when it names something. */
function refProblem(contract: Contract, value: string): string | undefined {
  if (value.includes('.')) {
    const problem = fieldProblem(contract.model, value)

    return problem === undefined ? undefined : `"${value}": ${problem}`
  }

  return has(contract.screens.platform.values ?? {}, value)
    ? undefined
    : `"${value}" is no value of platform.values`
}

/** Per keyword written beside the value that does not narrow it, why, by the keyword. */
function wideningProblems(
  contract: Contract,
  value: string,
  parameter: PlatformParameter,
): Array<{ keyword: string; message: string }> {
  const referred = resolveValue(value, contract.screens.platform, contract.model)

  if (referred === undefined) {
    return []
  }

  const inline = keywordsOf(parameter)

  return wideningsOf(referred, inline).map((keyword) => ({
    keyword,
    message: `${JSON.stringify(inline[keyword])} does not narrow the value "${value}", whose ${keyword} is ${JSON.stringify(referred[keyword])}: a keyword written beside \`value\` may only narrow it`,
  }))
}

export function valueProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)

  return Object.entries(contract.screens.platform.actions).flatMap(([action, { params }]) =>
    Object.entries(params).flatMap(([param, parameter]) => {
      const { value } = parameter
      const at = ['platform', 'actions', action, 'params', param]

      if (value === undefined) {
        return []
      }

      const problem = refProblem(contract, value)

      return problem === undefined
        ? wideningProblems(contract, value, parameter).map(({ keyword, message }) =>
            inScreens([...at, keyword], message),
          )
        : [inScreens([...at, 'value'], problem)]
    }),
  )
}
