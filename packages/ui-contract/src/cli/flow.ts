/** `ui-contract flow <screen> [--json]`. */

import { stringify } from 'yaml'

import { currentContract } from './problems'

/**
 * Prints the flow of the screen named by its id or by its file (`organisation`,
 * `contract/screens/org.yaml`) as every reader takes it: expanded from the shorter forms the
 * file may author it in, the machine config `createMachine` takes.
 */
export function flow(argv: readonly string[]): number {
  const [name] = argv.filter((arg) => !arg.startsWith('--'))

  if (name === undefined) {
    console.error('ui-contract: flow needs a screen: its id or its file')

    return 1
  }

  const contract = currentContract(process.cwd())

  if (contract === undefined) {
    return 1
  }

  const { screens, files } = contract.screens
  const at = screens.findIndex((screen, index) => screen.id === name || files[index] === name)
  const screen = screens[at]

  if (screen === undefined) {
    console.error(`ui-contract: no screen is named ${name}`)

    return 1
  }

  if (screen.flow === undefined) {
    console.error(`ui-contract: the screen ${screen.id} has no flow`)

    return 1
  }

  console.log(
    argv.includes('--json')
      ? JSON.stringify(screen.flow, null, 2)
      : stringify(screen.flow).trimEnd(),
  )

  return 0
}
