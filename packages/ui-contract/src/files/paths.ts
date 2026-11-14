/** Where the contract files and the scenarios sit, relative to the repository root. */

export const CONTRACT_DIR = 'contract'

/** The domain files: the model, the platform, the screens and the activities. */
export const DOMAIN_DIR = 'contract/domain'

export const VOCABULARY_FILE = 'contract/vocabulary.md'
export const MODEL_FILE = 'contract/domain/model.schema.json'

/** The screens, one YAML file each, named by the screen's pathname (`screenFile`). */
export const SCREENS_DIR = 'contract/domain/screens'

/** The contract version and the platform section every screen shares. */
export const PLATFORM_FILE = 'contract/domain/platform.yaml'

/**
 * The file of a screen, named by the path of its first binding without the leading `/`
 * (`/me` is `me.yaml`, `/org/$org` is `org/$org.yaml`, `/` is `index.yaml`); the frame,
 * the one screen without a binding, is `__root.yaml`.
 */
export function screenFile(firstPath: string | undefined): string {
  if (firstPath === undefined) {
    return `${SCREENS_DIR}/__root.yaml`
  }

  return `${SCREENS_DIR}/${firstPath === '/' ? 'index' : firstPath.slice(1)}.yaml`
}

/** The activities across screens, one YAML file each, named by its id; the folder is optional. */
export const ACTIVITIES_DIR = 'contract/domain/activities'

/** The file of the activity `id`. */
export const activityFile = (id: string): string => `${ACTIVITIES_DIR}/${id}.yaml`

/** The scenarios, one Markdown file each in the e2e tree, beside their tests: `<dir>/<id>.md`. */
export const SCENARIOS_DIR = 'tests/e2e/scenarios'

/** The file of the scenario `id`. */
export const scenarioFile = (id: string): string => `${SCENARIOS_DIR}/${id}.md`

/**
 * Whether a file, by its path from the repository root, is one of the business layer's: a
 * domain file, the vocabulary or a scenario. The vocabulary counts whole, though only its
 * content tables are the business layer's: its grammar is the engine's, which no path tells apart.
 */
export function isBusinessFile(path: string): boolean {
  return (
    path.startsWith(`${DOMAIN_DIR}/`) ||
    path === VOCABULARY_FILE ||
    path.startsWith(`${SCENARIOS_DIR}/`)
  )
}

export const SCREEN_SCHEMA_FILE = 'contract/schemas/screen.schema.json'
export const PLATFORM_SCHEMA_FILE = 'contract/schemas/platform.schema.json'
export const ACTIVITY_SCHEMA_FILE = 'contract/schemas/activity.schema.json'
export const ENTITY_SCHEMA_FILE = 'contract/schemas/x-perch.schema.json'
export const MANIFEST_SCHEMA_FILE = 'contract/schemas/manifest.schema.json'

/** The coverage note: prose around a block `ui-contract coverage --write` fills. */
export const COVERAGE_FILE = 'contract/COVERAGE.md'
