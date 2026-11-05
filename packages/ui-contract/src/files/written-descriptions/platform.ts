/**
 * The descriptions the platform file writes: each action's and each of its parameters', each
 * event's meaning, each composite's own and each of its items', the texts of the item anchors a
 * screen derives from it. An action's `result` is its behaviour, which the hand-over diff lists
 * among the action's lines, so it is no description.
 */

import { entriesOf, recordOf } from '../../records'

import { describedAt, type Found, meaningsAt } from './found'

/** The descriptions the platform file `value` writes, in the order of the file. */
export function platformDescriptions(value: unknown): Found[] {
  const { actions, events, composites } = recordOf(value)

  return [
    ...entriesOf(actions).flatMap(([name, action]) => [
      ...describedAt(action, ['actions', name], 'action', `platform action ${name}`),
      ...entriesOf(recordOf(action)['params']).flatMap(([param, parameter]) =>
        describedAt(
          parameter,
          ['actions', name, 'params', param],
          'actionParameter',
          `platform action ${name} param ${param}`,
        ),
      ),
    ]),
    ...meaningsAt(events, ['events'], 'event', (name) => `platform event ${name}`),
    ...entriesOf(composites).flatMap(([name, composite]) => [
      ...describedAt(composite, ['composites', name], 'composite', `platform composite ${name}`),
      ...meaningsAt(
        recordOf(composite)['items'],
        ['composites', name, 'items'],
        'compositeItem',
        (item) => `platform composite ${name} item ${item}`,
      ),
    ]),
  ]
}
