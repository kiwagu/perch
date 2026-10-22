/**
 * The coverage measure as text: the block of the coverage note, the model's measure first
 * (fields and actions bound, a table per entity, then the transitions of each activity its
 * scenarios walk), then the code's (controls marked per module, the unmarked and the ignored
 * controls, anchors and scenarios per screen); and the lists `ui-contract coverage
 * --unmarked` prints, one `file:line: <element>` per control.
 */

import type { CoverageMeasure, FileControl } from './coverage'
import type { BoundMember } from './model'

const share = (marked: number, controls: number): string =>
  controls === 0 ? '-' : `${Math.round((marked / controls) * 100)}%`

const row = (cells: ReadonlyArray<string | number>): string => `| ${cells.join(' | ')} |`

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

const boundShare = (members: readonly BoundMember[]): string =>
  `${members.filter(({ anchors }) => anchors.length > 0).length}/${members.length}`

/** A control as a line: `file:line: tag "label"`, then ` — reason` when it is ignored. */
const lineOf = (control: FileControl & { reason?: string }): string =>
  [
    `${control.file}:${control.line}: ${control.tag}`,
    control.label === undefined ? '' : ` ${JSON.stringify(control.label)}`,
    control.reason === undefined ? '' : ` — ${control.reason}`,
  ].join('')

const listed = (controls: ReadonlyArray<FileControl & { reason?: string }>): string[] =>
  controls.length === 0 ? ['None.'] : ['```text', ...controls.map(lineOf), '```']

const anchorsCell = ({ anchors }: BoundMember): string =>
  anchors.length === 0 ? 'unbound' : anchors.map((anchor) => `\`${anchor}\``).join(', ')

function modelSection(model: CoverageMeasure['model']): string[] {
  return model.flatMap(({ entity, fields, actions }) => [
    `### ${entity}`,
    '',
    row(['Field or action', 'Kind', 'Anchors']),
    row(['---', '---', '---']),
    ...fields.map((field) => row([field.name, 'field', anchorsCell(field)])),
    ...actions.map((action) => row([action.name, 'action', anchorsCell(action)])),
    '',
  ])
}

/** The activities after the model, when the contract has any. */
function activitiesSection(activities: CoverageMeasure['activities']): string[] {
  if (activities.length === 0) {
    return []
  }

  return [
    '## Activities',
    '',
    row(['Activity', 'Scenarios', 'Transitions', 'Walked']),
    row(['---', '---:', '---:', '---:']),
    ...activities.map(({ id, scenarios, transitions, walked }) =>
      row([id, scenarios, transitions, walked]),
    ),
    '',
  ]
}

/** `; activities n, transitions walked x/y` for the totals, when the contract has any. */
function activitiesTotal(activities: CoverageMeasure['activities']): string {
  const walked = sum(activities.map((activity) => activity.walked))
  const transitions = sum(activities.map((activity) => activity.transitions))

  return activities.length === 0
    ? ''
    : `; activities ${activities.length}, transitions walked ${walked}/${transitions}`
}

/** The block of the note: the totals, the model, the activities, the controls, the screens. */
export function renderCoverage(
  measure: CoverageMeasure,
  totals: { anchors: number; codes: number; screens: number },
): string {
  const controls = sum(measure.modules.map((module) => module.controls))
  const marked = sum(measure.modules.map((module) => module.marked))
  const ignored = sum(measure.modules.map((module) => module.ignored))
  const fields = measure.model.flatMap((entity) => entity.fields)
  const actions = measure.model.flatMap((entity) => entity.actions)

  return [
    `The contract declares ${totals.screens} screens, ${totals.anchors} anchors and ${totals.codes} codes.`,
    '',
    `Totals: fields bound ${boundShare(fields)}, actions bound ${boundShare(actions)}${activitiesTotal(measure.activities)}; controls marked ${marked}/${controls}, ignored ${ignored}.`,
    '',
    '## Model',
    '',
    ...modelSection(measure.model),
    ...activitiesSection(measure.activities),
    '## Controls',
    '',
    row(['Module', 'Controls', 'Marked', 'Ignored', 'Share']),
    row(['---', '---:', '---:', '---:', '---:']),
    ...measure.modules.map((module) =>
      row([
        module.module,
        module.controls,
        module.marked,
        module.ignored,
        share(module.marked, module.controls),
      ]),
    ),
    row(['all', controls, marked, ignored, share(marked, controls)]),
    '',
    '### Unmarked',
    '',
    ...listed(measure.unmarked),
    '',
    '### Ignored',
    '',
    ...listed(measure.ignored),
    '',
    '## Screens',
    '',
    row(['Screen', 'Anchors', 'Scenarios']),
    row(['---', '---:', '---:']),
    ...measure.screens.map((screen) => row([screen.id, screen.anchors, screen.scenarios])),
  ].join('\n')
}

/** The unmarked controls, then the ignored ones with their reasons, a line each. */
export const listControls = ({ unmarked, ignored }: CoverageMeasure): string =>
  [
    `Unmarked controls: ${unmarked.length}`,
    ...unmarked.map(lineOf),
    '',
    `Ignored controls: ${ignored.length}`,
    ...ignored.map(lineOf),
  ].join('\n')
