/**
 * The contract check: loads the contract files and the scenarios (stopping at their own
 * problems), then runs every cross-check and the schema drift, and returns the problems
 * sorted by file and line.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  loadModel,
  loadScenarios,
  loadScreens,
  type Problem,
  parseVocabulary,
  schemaDrift,
  sortProblems,
  VOCABULARY_FILE,
} from '../files'

import { bindingsProblems } from './bindings'
import type { Contract } from './contract'
import { flowProblems } from './flow'
import { routesProblems } from './routes'
import { scenariosProblems } from './scenarios'
import { screensProblems } from './screens'
import { searchProblems } from './search'
import { versionProblems } from './version'
import { vocabularyProblems } from './vocabulary'

function loadVocabulary(root: string): ReturnType<typeof parseVocabulary> {
  let markdown: string

  try {
    markdown = readFileSync(join(root, VOCABULARY_FILE), 'utf8')
  } catch {
    return {
      ...parseVocabulary(''),
      problems: [{ file: VOCABULARY_FILE, message: 'cannot read the file' }],
    }
  }

  return parseVocabulary(markdown)
}

/** The contract files and the scenarios, or the problems that keep them from loading. */
export function loadContract(root: string): { contract?: Contract; problems: Problem[] } {
  const { vocabulary, problems: vocabularyLoad } = loadVocabulary(root)
  const { screens, problems: screensLoad } = loadScreens(root)
  const { model, problems: modelLoad } = loadModel(root)
  const { scenarios, problems: scenariosLoad } = loadScenarios(root)
  const problems = [...vocabularyLoad, ...screensLoad, ...modelLoad, ...scenariosLoad]

  return problems.length > 0 || screens === undefined || model === undefined
    ? { problems: sortProblems(problems) }
    : { contract: { vocabulary, screens, model, scenarios }, problems: [] }
}

const RULES: ReadonlyArray<(contract: Contract) => Problem[]> = [
  versionProblems,
  vocabularyProblems,
  screensProblems,
  bindingsProblems,
  flowProblems,
  routesProblems,
  searchProblems,
  scenariosProblems,
]

export function checkContract(root: string): Problem[] {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    return problems
  }

  return sortProblems([...RULES.flatMap((rule) => rule(contract)), ...schemaDrift(root)])
}
