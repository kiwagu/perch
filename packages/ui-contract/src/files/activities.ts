/**
 * Reads the activities: each `.yaml` file under `contract/activities`, sorted by path, is one
 * activity through `activitySchema`, its file named by its id (`session` is
 * `contract/activities/session.yaml`). The folder is optional: without it the contract has no
 * activity. A file that is not `.yaml`, one named otherwise than its id, and the problems of
 * its YAML and its shape are problems of that file.
 */

import { join } from 'node:path'

import type { z } from '@workspace/zod'

import { activitySchema } from '../schemas'

import { filesUnder } from './files-under'
import { parseFile } from './parse-file'
import { ACTIVITIES_DIR, activityFile } from './paths'
import type { Problem } from './problems'
import { readYaml } from './read-yaml'

export type Activity = z.infer<typeof activitySchema>
export type ActivityState = Activity['states'][string]
export type ActivityTransition = Extract<
  NonNullable<ActivityState['on']>[string],
  { target: string }
>

const SUFFIX = '.yaml'

function readActivity(root: string, file: string): { activity?: Activity; problems: Problem[] } {
  const read = readYaml(root, file)

  if (read.problems.length > 0) {
    return { problems: read.problems }
  }

  const parsed = parseFile(file, activitySchema, read.value)

  if (parsed.value === undefined) {
    return { problems: parsed.problems }
  }

  const named = activityFile(parsed.value.id)

  return named === file
    ? { activity: parsed.value, problems: [] }
    : {
        problems: [{ file, message: `its id is "${parsed.value.id}", so its file is ${named}` }],
      }
}

export function loadActivities(root: string): { activities: Activity[]; problems: Problem[] } {
  const activities: Activity[] = []
  const problems: Problem[] = []

  for (const path of filesUnder(join(root, ACTIVITIES_DIR)) ?? []) {
    const file = `${ACTIVITIES_DIR}/${path}`

    if (path.endsWith(SUFFIX)) {
      const read = readActivity(root, file)

      problems.push(...read.problems)

      if (read.activity !== undefined) {
        activities.push(read.activity)
      }
    } else {
      problems.push({
        file,
        message: `not an activity file: the folder holds \`<id>${SUFFIX}\` files only`,
      })
    }
  }

  return { activities, problems }
}
