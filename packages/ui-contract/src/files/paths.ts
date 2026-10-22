/** Where the contract files and the scenarios sit, relative to the repository root. */

export const CONTRACT_DIR = 'contract'

export const VOCABULARY_FILE = 'contract/vocabulary.md'
export const MODEL_FILE = 'contract/model.schema.json'

/** The screens, one YAML file each, named by the screen's pathname (`screenFile`). */
export const SCREENS_DIR = 'contract/screens'

/** The contract version and the platform section every screen shares. */
export const PLATFORM_FILE = 'contract/platform.yaml'

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

/** The scenarios, one Markdown file each in the e2e tree, beside their tests: `<dir>/<id>.md`. */
export const SCENARIOS_DIR = 'tests/e2e/scenarios'

/** The file of the scenario `id`. */
export const scenarioFile = (id: string): string => `${SCENARIOS_DIR}/${id}.md`

export const SCREEN_SCHEMA_FILE = 'contract/screen.schema.json'
export const PLATFORM_SCHEMA_FILE = 'contract/platform.schema.json'
export const ENTITY_SCHEMA_FILE = 'contract/x-perch.schema.json'
export const MANIFEST_SCHEMA_FILE = 'contract/manifest.schema.json'

/** The coverage note: prose around a block `ui-contract coverage --write` fills. */
export const COVERAGE_FILE = 'contract/COVERAGE.md'
