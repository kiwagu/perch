/**
 * Rule 7: a contract is read by the version `platform.yaml` declares, one this engine reads (up
 * to `CONTRACT_VERSION`); a newer one is a problem here, never a failure to parse. At version 1
 * the vocabulary repeats it, `Contract version: 1`, a line it must hold, equal; from version 2
 * `platform.yaml` alone says it, and the line is refused. An older version passes the check:
 * `outdatedProblem` names it, which `ui-contract check --current` fails on.
 */

import { CONTRACT_VERSION } from '../anchors'
import { PLATFORM_FILE, type Problem, VOCABULARY_FILE } from '../files'

import { type Contract, locate } from './contract'
import { editionOf, since } from './editions'

/** The version from which the version is said once, in `platform.yaml`. */
const SAID_ONCE = 2

/** What is wrong with the vocabulary's `Contract version` line, by the contract's version. */
function lineProblem(contract: Contract): Problem | undefined {
  const line = contract.vocabulary.version
  const version = editionOf(contract)

  if (since(contract, SAID_ONCE)) {
    return line === undefined
      ? undefined
      : {
          file: VOCABULARY_FILE,
          message: `Contract version: ${line}: from version ${SAID_ONCE} the version is written in platform.yaml alone (bun run contract:migrate --write removes the line)`,
        }
  }

  if (line === undefined) {
    return {
      file: VOCABULARY_FILE,
      message: `no "Contract version: ${version}" line: at version ${version} the vocabulary says the version too`,
    }
  }

  return line === version
    ? undefined
    : {
        file: VOCABULARY_FILE,
        message: `Contract version: ${line} differs from the version ${version} of platform.yaml`,
      }
}

export function versionProblems(contract: Contract): Problem[] {
  const version = editionOf(contract)

  if (version > CONTRACT_VERSION) {
    return [
      locate(contract.screens)(
        ['version'],
        `${version} is newer than this engine, which reads up to version ${CONTRACT_VERSION}`,
      ),
    ]
  }

  const line = lineProblem(contract)

  return line === undefined ? [] : [line]
}

/** A contract at a version older than this engine's, which `contract:migrate` moves; else none. */
export function outdatedProblem(contract: Contract): Problem | undefined {
  const version = editionOf(contract)

  return version < CONTRACT_VERSION
    ? {
        file: PLATFORM_FILE,
        message: `the contract is at version ${version}; this engine reads up to ${CONTRACT_VERSION} (bun run contract:migrate)`,
      }
    : undefined
}
