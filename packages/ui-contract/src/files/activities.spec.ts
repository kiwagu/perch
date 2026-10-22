import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import { loadActivities } from './activities'
import { ACTIVITIES_DIR } from './paths'
import { formatProblem } from './problems'

const FIXTURE = join(import.meta.dirname, '../__fixtures__/contract/activities')
const THING_FILE = 'contract/activities/thing.yaml'

let root: string

/** Writes `text` at `file`, relative to the temporary root. */
function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

/** The fixture's activity as data, for a case to change and write back. */
const thing = (): Record<string, unknown> =>
  parse(readFileSync(join(FIXTURE, 'thing.yaml'), 'utf8')) as Record<string, unknown>

/** The fixture's activity under the id `id`, written to `file`. */
const writeAs = (file: string, id: string): void => write(file, stringify({ ...thing(), id }))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-activities-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadActivities', () => {
  it('loads the fixture: its activity with its machine', () => {
    cpSync(FIXTURE, join(root, ACTIVITIES_DIR), { recursive: true })

    const { activities, problems } = loadActivities(root)

    expect(problems).toEqual([])
    expect(activities.map((activity) => activity.id)).toEqual(['thing'])
    expect(activities[0]?.states['editing']?.meta).toEqual({
      screen: 'sample',
      address: { path: '/sample/$key' },
    })
    expect(activities[0]?.data?.['thing.title']?.model).toBe('thing.title')
  })
  it('finds no activity, and no problem, without the folder', () => {
    expect(loadActivities(root)).toEqual({ activities: [], problems: [] })
  })
  it('reads the folder sorted by path', () => {
    writeAs('contract/activities/session.yaml', 'session')
    writeAs('contract/activities/invite.yaml', 'invite')

    expect(loadActivities(root).activities.map((activity) => activity.id)).toEqual([
      'invite',
      'session',
    ])
  })
  it('reports a file named otherwise than its id, a nested one and one that is not YAML', () => {
    writeAs('contract/activities/session.yaml', 'sessions')
    writeAs('contract/activities/user/session.yaml', 'session')
    write('contract/activities/notes.txt', 'Notes.\n')

    expect(loadActivities(root)).toEqual({
      activities: [],
      problems: [
        {
          file: 'contract/activities/notes.txt',
          message: 'not an activity file: the folder holds `<id>.yaml` files only',
        },
        {
          file: 'contract/activities/session.yaml',
          message: 'its id is "sessions", so its file is contract/activities/sessions.yaml',
        },
        {
          file: 'contract/activities/user/session.yaml',
          message: 'its id is "session", so its file is contract/activities/session.yaml',
        },
      ],
    })
  })
  it('locates a problem of the shape in its file, by its path there', () => {
    const activity = thing()

    Object.assign(activity, { context: {} })
    write(THING_FILE, stringify(activity))

    expect(loadActivities(root).problems.map(formatProblem)).toEqual([
      `${THING_FILE}:1: (root): Unrecognized key: "context"`,
    ])
  })
  it('reports a file that is not YAML at its line', () => {
    write(THING_FILE, 'id: thing\ntitle: [Edit,\nroles: [ member ]\n')

    expect(loadActivities(root).problems.map(formatProblem)).toEqual([
      expect.stringMatching(/^contract\/activities\/thing\.yaml:3: not YAML: /),
    ])
  })
})
