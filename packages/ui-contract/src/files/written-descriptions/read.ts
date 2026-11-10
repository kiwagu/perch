/**
 * Reads every description written in the files of `contract/domain`, as the files write them:
 * the screen files, the platform file, the activities and the model, each through YAML (the
 * model's JSON is YAML too, so each description has its line), in the order the loaders read
 * them. Never a description the engine derives or the loader fills in as it expands a shorter
 * form: those are not written. The budget of `contract:check` and the description lines of the
 * hand-over diff read them here, the contract at a ref included.
 */

import { join } from 'node:path'

import { filesUnder } from '../files-under'
import { ACTIVITIES_DIR, MODEL_FILE, PLATFORM_FILE, SCREENS_DIR } from '../paths'
import { lineAt, type Problem } from '../problems'
import { readYaml } from '../read-yaml'

import { activityDescriptions } from './activity'
import type { Found } from './found'
import { modelDescriptions } from './model'
import { platformDescriptions } from './platform'
import { screenDescriptions } from './screen'

/** A description as a file of `contract/domain` writes it: its file, its line, its place. */
export interface WrittenDescription extends Found {
  readonly file: string
  /** The line of its key in the file. */
  readonly line?: number
}

const SUFFIX = '.yaml'

/** The `.yaml` files under `dir`, from the root, sorted; none when the folder is not there. */
const yamlFilesUnder = (root: string, dir: string): string[] =>
  (filesUnder(join(root, dir)) ?? [])
    .filter((path) => path.endsWith(SUFFIX))
    .map((path) => `${dir}/${path}`)

export function readDescriptions(root: string): {
  descriptions: WrittenDescription[]
  problems: Problem[]
} {
  const files: ReadonlyArray<{ file: string; descriptionsOf: (value: unknown) => Found[] }> = [
    ...yamlFilesUnder(root, SCREENS_DIR).map((file) => ({
      file,
      descriptionsOf: screenDescriptions,
    })),
    { file: PLATFORM_FILE, descriptionsOf: platformDescriptions },
    ...yamlFilesUnder(root, ACTIVITIES_DIR).map((file) => ({
      file,
      descriptionsOf: activityDescriptions,
    })),
    { file: MODEL_FILE, descriptionsOf: modelDescriptions },
  ]
  const problems: Problem[] = []
  const descriptions = files.flatMap(({ file, descriptionsOf }) => {
    const { value, lines, problems: unread } = readYaml(root, file)

    problems.push(...unread)

    return unread.length > 0
      ? []
      : descriptionsOf(value).map((found): WrittenDescription => {
          const line = lineAt(lines, found.at)

          return line === undefined ? { file, ...found } : { file, line, ...found }
        })
  })

  return { descriptions, problems }
}
