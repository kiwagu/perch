/**
 * The contract check: loads the contract files, the activities and the scenarios (stopping at
 * their own problems), then runs every cross-check, the schema drift, the reference's drift and the
 * links of the guides into it, and returns the problems sorted by file and line.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  hintBudgetProblems,
  loadActivities,
  loadModel,
  loadScenarios,
  loadScreensWith,
  type Problem,
  parseVocabulary,
  readDescriptions,
  SCHEMA_OUTPUTS,
  schemaDrift,
  sortProblems,
  VOCABULARY_FILE,
} from '../files'
import { referenceDrift, referenceLinkProblems } from '../reference'

import { accessProblems } from './access'
import { activitiesProblems } from './activities'
import { attributionProblems } from './attribution'
import { behaviourTextsProblems } from './behaviour-texts'
import { bindingsProblems } from './bindings'
import { changesProblems } from './changes'
import { confirmationsProblems } from './confirmations'
import type { Contract } from './contract'
import { descriptionsProblems } from './descriptions'
import { flowProblems } from './flow'
import { invariantsProblems } from './invariants'
import { keyProblems } from './keys'
import { leavingProblems } from './leaving'
import { mailsProblems } from './mails'
import { noticesProblems } from './notices'
import { pagingProblems } from './paging'
import { routesProblems } from './routes'
import { runsProblems } from './runs'
import { scenariosProblems } from './scenarios'
import { screensProblems } from './screens'
import { searchProblems } from './search'
import { toastsProblems } from './toasts'
import { unsavedInputProblems } from './unsaved-input'
import { valueProblems } from './values'
import { versionProblems } from './version'
import { vocabularyProblems } from './vocabulary'
import { withProblems } from './with'

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

/**
 * The contract files, the activities and the scenarios, with the descriptions they write, or what
 * keeps them from loading.
 */
export function loadContract(root: string): { contract?: Contract; problems: Problem[] } {
  const { vocabulary, problems: vocabularyLoad } = loadVocabulary(root)
  const { model: written, problems: modelLoad } = loadModel(root)
  // The model every rule reads is the one the screens were derived from: its lengths resolved.
  const { screens, model, problems: screensLoad } = loadScreensWith(root, written)
  const { activities, lines: activityLines, problems: activitiesLoad } = loadActivities(root)
  const { scenarios, lines: scenarioLines, problems: scenariosLoad } = loadScenarios(root)
  const problems = [
    ...vocabularyLoad,
    ...screensLoad,
    ...modelLoad,
    ...activitiesLoad,
    ...scenariosLoad,
  ]

  if (problems.length > 0 || screens === undefined || model === undefined) {
    return { problems: sortProblems(problems) }
  }

  const { descriptions, problems: descriptionsRead } = readDescriptions(root)

  return descriptionsRead.length > 0
    ? { problems: sortProblems(descriptionsRead) }
    : {
        contract: {
          vocabulary,
          screens,
          model,
          activities,
          activityLines,
          scenarios,
          scenarioLines,
          descriptions,
        },
        problems: [],
      }
}

const RULES: ReadonlyArray<(contract: Contract) => Problem[]> = [
  versionProblems,
  vocabularyProblems,
  screensProblems,
  bindingsProblems,
  flowProblems,
  activitiesProblems,
  runsProblems,
  routesProblems,
  leavingProblems,
  toastsProblems,
  confirmationsProblems,
  unsavedInputProblems,
  valueProblems,
  attributionProblems,
  invariantsProblems,
  searchProblems,
  keyProblems,
  mailsProblems,
  noticesProblems,
  changesProblems,
  accessProblems,
  pagingProblems,
  scenariosProblems,
  descriptionsProblems,
  behaviourTextsProblems,
  withProblems,
]

/** What every rule of the contract finds in a contract already loaded, sorted by file and line. */
export const contractProblems = (contract: Contract): Problem[] =>
  sortProblems(RULES.flatMap((rule) => rule(contract)))

export function checkContract(root: string): Problem[] {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    return problems
  }

  return sortProblems([
    ...contractProblems(contract),
    ...schemaDrift(root),
    ...hintBudgetProblems(SCHEMA_OUTPUTS),
    ...referenceDrift(root),
    ...referenceLinkProblems(root),
  ])
}
