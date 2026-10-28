/**
 * Rule 7: `platform.yaml` and `vocabulary.md` are written for the contract version this
 * tooling reads (`CONTRACT_VERSION`), so they agree with each other too.
 */

import { CONTRACT_VERSION } from '../anchors'
import { type Problem, VOCABULARY_FILE } from '../files'

import { type Contract, locate } from './contract'

const differs = (version: number | undefined): string =>
  `${String(version)} differs from the contract version ${CONTRACT_VERSION} of the tooling`

export const versionProblems = ({ screens, vocabulary }: Contract): Problem[] => [
  ...(Number(screens.version) === CONTRACT_VERSION
    ? []
    : [locate(screens)(['version'], differs(screens.version))]),
  ...(vocabulary.version === CONTRACT_VERSION
    ? []
    : [{ file: VOCABULARY_FILE, message: `Contract version: ${differs(vocabulary.version)}` }]),
]
