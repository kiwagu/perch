/** `ui-contract check [--sources [--ahead]] [--consumers [--tests=<dir>]]`. */

import { type Contract, checkContract, declaredAnchors, loadContract } from '../check'
import { CONSUMER_ROOT, compareConsumers, scanConsumers } from '../consumers'
import { totalsOf } from '../handoff'
import { compareWithContract, scanSources } from '../sources'

import { reported } from './problems'

const summaryOf = (contract: Contract): string => {
  const { anchors, codes, screens } = totalsOf(contract)

  return [
    `contract: ${screens} screens`,
    `${anchors} anchors`,
    `${codes} codes`,
    `${contract.scenarios.length} scenarios`,
    `${contract.activities.length} activities`,
    `version ${contract.screens.version}`,
  ].join(', ')
}

function checkSources(root: string, { screens, vocabulary }: Contract, ahead: boolean): number {
  const collected = scanSources(root)

  if (reported(compareWithContract(collected, screens, vocabulary, { ahead }))) {
    return 1
  }

  const anchors = new Set(collected.flatMap(({ literals }) => literals.map(({ anchor }) => anchor)))
  const unrendered = declaredAnchors(screens).filter(({ anchor }) => !anchors.has(anchor)).length

  console.log(
    unrendered === 0
      ? `contract: sources agree with the contract (${anchors.size} anchors)`
      : `contract: sources use only what the contract declares (${anchors.size} anchors; ${unrendered} declared, not rendered yet)`,
  )

  return 0
}

function checkConsumers(root: string, contract: Contract, tests: string): number {
  const consumed = scanConsumers(root, tests)

  if (reported(compareConsumers(consumed, contract))) {
    return 1
  }

  const anchors = new Set(
    consumed.flatMap(({ literals }) =>
      literals.filter(({ kind }) => kind === 'anchor').map(({ value }) => value),
    ),
  )

  console.log(`contract: the e2e tests agree with the contract (${anchors.size} anchors)`)

  return 0
}

/** The value of `--<name>=<value>`, if given. */
const optionOf = (argv: readonly string[], name: string): string | undefined =>
  argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)

export function check(argv: readonly string[]): number {
  const root = process.cwd()

  if (reported(checkContract(root))) {
    return 1
  }

  const { contract } = loadContract(root)

  if (contract === undefined) {
    return 1
  }

  console.log(summaryOf(contract))

  const sources = argv.includes('--sources')
    ? checkSources(root, contract, argv.includes('--ahead'))
    : 0
  const tests = optionOf(argv, 'tests') ?? CONSUMER_ROOT
  const consumers = argv.includes('--consumers') ? checkConsumers(root, contract, tests) : 0

  return Math.max(sources, consumers)
}
