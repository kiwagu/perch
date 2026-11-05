/**
 * The descriptions an activity file writes: the activity's own, each piece of data's, each
 * sentence guard of its `meta.guards`, each visit's and each transition's, by the state it leaves
 * (`activity session state profile on <anchor> #1`).
 */

import { entriesOf, recordOf } from '../../records'

import { describedAt, type Found, meaningsAt, nameOf, transitionsAt } from './found'

/** The descriptions the activity file `value` writes, in the order of the file. */
export function activityDescriptions(value: unknown): Found[] {
  const id = nameOf(value, 'id', 'an activity file')
  const head = `activity ${id}`
  const { data, meta, states } = recordOf(value)

  return [
    ...describedAt(value, [], 'activity', head),
    ...entriesOf(data).flatMap(([name, carried]) =>
      describedAt(carried, ['data', name], 'activityData', `${head} data ${name}`),
    ),
    ...meaningsAt(
      recordOf(meta)['guards'],
      ['meta', 'guards'],
      'activityGuard',
      (name) => `${head} guard ${name}`,
    ),
    ...entriesOf(states).flatMap(([name, state]) => {
      const place = `${head} state ${name}`

      return [
        ...describedAt(state, ['states', name], 'visit', place),
        ...entriesOf(recordOf(state)['on']).flatMap(([anchor, transitions]) =>
          transitionsAt(
            transitions,
            ['states', name, 'on', anchor],
            'activityTransition',
            `${place} on ${anchor}`,
          ),
        ),
      ]
    }),
  ]
}
