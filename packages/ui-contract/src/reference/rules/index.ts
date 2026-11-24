import type { ReferenceRule } from '../rule'

import { ANCHOR_RULES } from './anchors'
import { ANSWER_RULES } from './answers'
import { CHECK_RULES } from './checks'
import { COMMIT_RULES } from './commits'
import { COVERAGE_RULES } from './coverage'
import { EMIT_RULES } from './emits'
import { FLOW_RULES } from './flows'
import { HANDOFF_RULES } from './handoff'
import { INSTRUCTION_RULES } from './instructions'
import { LEAVES_OUT_RULES } from './leaves-out'
import { MANIFEST_RULES } from './manifest'
import { OUTCOME_RULES } from './outcomes'
import { PAGING_RULES } from './paging'
import { PAIR_RULES } from './pairs'
import { READ_RULES } from './reads'
import { RENDER_RULES } from './renders'
import { ROUTE_RULES } from './routes'
import { SCENARIO_RULES } from './scenarios'
import { TERMS_RULES } from './terms'
import { VALUE_RULES } from './values'

export { INSTRUCTION_RULES } from './instructions'

/**
 * Every rule of the engine that no key states, in the order the reference writes them: the
 * anchors and the routes, the project's terms, the flows and what they render and read, a paged list, the values, what a platform action answers,
 * what a screen leaves out, a password pair, the scenarios, the checks, the commits, the manifest,
 * the emitted modules, the hand-over and the coverage, and last the fixed texts of the manifest's
 * instructions.
 */
export const REFERENCE_RULES: readonly ReferenceRule[] = [
  ...ANCHOR_RULES,
  ...ROUTE_RULES,
  ...TERMS_RULES,
  ...FLOW_RULES,
  ...RENDER_RULES,
  ...READ_RULES,
  ...PAGING_RULES,
  ...VALUE_RULES,
  ...ANSWER_RULES,
  ...LEAVES_OUT_RULES,
  ...PAIR_RULES,
  ...OUTCOME_RULES,
  ...SCENARIO_RULES,
  ...CHECK_RULES,
  ...COMMIT_RULES,
  ...MANIFEST_RULES,
  ...EMIT_RULES,
  ...HANDOFF_RULES,
  ...COVERAGE_RULES,
  ...Object.values(INSTRUCTION_RULES),
]
