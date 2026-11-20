/**
 * `ui-contract emit values|fields --out <file>`, from the root or any folder under it: writes the
 * module of plain data a layer below the contract reads (`valuesModuleOf`, `fieldFactsModuleOf`)
 * into the file the caller names, relative to the folder it runs from. The engine knows no package
 * and writes nowhere by default. A contract that fails the contract check is not emitted: its
 * problems are printed and nothing is written.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { type Contract, checkContract, loadContract } from '../check'
import { fieldFactsModuleOf, valuesModuleOf } from '../emit'
import { PLATFORM_FILE } from '../files'

import { contractRoot } from './contract-root'
import { reported } from './problems'

const MODULES: Readonly<Record<string, (contract: Contract) => string>> = {
  values: valuesModuleOf,
  fields: fieldFactsModuleOf,
}

const USAGE = `use "emit ${Object.keys(MODULES).join('|')} --out <file>"`

export function emit(argv: readonly string[]): number {
  const [kind = '', ...rest] = argv
  const moduleOf = Object.hasOwn(MODULES, kind) ? MODULES[kind] : undefined
  const at = rest.indexOf('--out')
  const out = at === -1 ? undefined : rest[at + 1]

  if (moduleOf === undefined || out === undefined) {
    console.error(`ui-contract: ${USAGE}`)

    return 1
  }

  const root = contractRoot(process.cwd())

  if (root === undefined) {
    console.error(`ui-contract: no ${PLATFORM_FILE} here or in a folder above`)

    return 1
  }

  if (reported(checkContract(root))) {
    return 1
  }

  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    reported(problems)

    return 1
  }

  const file = resolve(process.cwd(), out)

  writeFileSync(file, moduleOf(contract))
  console.log(`ui-contract: wrote ${file}`)

  return 0
}
