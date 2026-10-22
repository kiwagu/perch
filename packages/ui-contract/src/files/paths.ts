/** Where the contract files and the scenarios sit, relative to the repository root. */

export const CONTRACT_DIR = 'contract'

export const VOCABULARY_FILE = 'contract/vocabulary.md'
export const SCREENS_FILE = 'contract/screens.json'
export const MODEL_FILE = 'contract/model.schema.json'

/** The scenarios, one Markdown file each in the e2e tree, beside their tests: `<dir>/<id>.md`. */
export const SCENARIOS_DIR = 'tests/e2e/scenarios'

/** The file of the scenario `id`. */
export const scenarioFile = (id: string): string => `${SCENARIOS_DIR}/${id}.md`

export const SCREENS_SCHEMA_FILE = 'contract/screens.schema.json'
export const ENTITY_SCHEMA_FILE = 'contract/x-perch.schema.json'
export const MANIFEST_SCHEMA_FILE = 'contract/manifest.schema.json'

/** The coverage note: prose around a block `ui-contract coverage --write` fills. */
export const COVERAGE_FILE = 'contract/COVERAGE.md'
