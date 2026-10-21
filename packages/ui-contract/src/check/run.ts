/**
 * The contract check: loads the three files (stopping at their own problems), then runs
 * every cross-check and the schema drift, and returns the problems sorted by file and line.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  loadModel,
  loadScreens,
  type Problem,
  parseVocabulary,
  schemaDrift,
  VOCABULARY_FILE,
} from '../files'

import { bindingsProblems } from './bindings'
import type { Contract } from './contract'
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

/** Stable: problems of one file and line keep the order the rules found them in. */
const sorted = (problems: readonly Problem[]): Problem[] =>
  [...problems].sort((a, b) => a.file.localeCompare(b.file, 'en') || (a.line ?? 1) - (b.line ?? 1))

/** The three files, or the problems that keep them from loading. */
export function loadContract(root: string): { contract?: Contract; problems: Problem[] } {
  const { vocabulary, problems: vocabularyLoad } = loadVocabulary(root)
  const { screens, problems: screensLoad } = loadScreens(root)
  const { model, problems: modelLoad } = loadModel(root)
  const problems = [...vocabularyLoad, ...screensLoad, ...modelLoad]

  return problems.length > 0 || screens === undefined || model === undefined
    ? { problems: sorted(problems) }
    : { contract: { vocabulary, screens, model }, problems: [] }
}

const RULES: ReadonlyArray<(contract: Contract) => Problem[]> = [
  versionProblems,
  vocabularyProblems,
  screensProblems,
  bindingsProblems,
  routesProblems,
  searchProblems,
  scenariosProblems,
]

export function checkContract(root: string): Problem[] {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    return problems
  }

  return sorted([...RULES.flatMap((rule) => rule(contract)), ...schemaDrift(root)])
}
