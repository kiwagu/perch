import { describe, expect, it } from 'vitest'

import type { CoverageMeasure } from './coverage'
import { listControls, renderCoverage } from './render'

const MEASURE: CoverageMeasure = {
  model: [
    {
      entity: 'thing',
      fields: [
        { name: 'id', anchors: [] },
        { name: 'title', anchors: ['sample.title-input'] },
      ],
      actions: [
        { name: 'createThing', anchors: ['sample.save-button', 'sample.other-button'] },
        { name: 'updateThing', anchors: [] },
      ],
    },
  ],
  modules: [
    { module: 'alpha', controls: 3, marked: 2, ignored: 1 },
    { module: 'beta', controls: 0, marked: 0, ignored: 0 },
    { module: 'ui kit', controls: 1, marked: 0, ignored: 0 },
  ],
  unmarked: [
    { file: 'apps/web/src/features/alpha/a.tsx', line: 4, tag: 'a', label: 'home' },
    { file: 'packages/ui/src/b.tsx', line: 2, tag: 'div' },
  ],
  ignored: [
    {
      file: 'apps/web/src/features/alpha/a.tsx',
      line: 6,
      tag: 'button',
      label: 'go',
      reason: 'a mouse convenience',
    },
  ],
  screens: [
    { id: 'sample', anchors: 6, scenarios: 1 },
    { id: 'other', anchors: 2, scenarios: 0 },
  ],
  problems: [],
}

describe('renderCoverage', () => {
  it('prints the totals, the model per entity, the controls per module and the screens', () => {
    expect(renderCoverage(MEASURE, { anchors: 8, codes: 2, screens: 2 }).split('\n')).toEqual([
      'The contract declares 2 screens, 8 anchors and 2 codes.',
      '',
      'Totals: fields bound 1/2, actions bound 1/2; controls marked 2/4, ignored 1.',
      '',
      '## Model',
      '',
      '### thing',
      '',
      '| Field or action | Kind | Anchors |',
      '| --- | --- | --- |',
      '| id | field | unbound |',
      '| title | field | `sample.title-input` |',
      '| createThing | action | `sample.save-button`, `sample.other-button` |',
      '| updateThing | action | unbound |',
      '',
      '## Controls',
      '',
      '| Module | Controls | Marked | Ignored | Share |',
      '| --- | ---: | ---: | ---: | ---: |',
      '| alpha | 3 | 2 | 1 | 67% |',
      '| beta | 0 | 0 | 0 | - |',
      '| ui kit | 1 | 0 | 0 | 0% |',
      '| all | 4 | 2 | 1 | 50% |',
      '',
      '### Unmarked',
      '',
      '```text',
      'apps/web/src/features/alpha/a.tsx:4: a "home"',
      'packages/ui/src/b.tsx:2: div',
      '```',
      '',
      '### Ignored',
      '',
      '```text',
      'apps/web/src/features/alpha/a.tsx:6: button "go" — a mouse convenience',
      '```',
      '',
      '## Screens',
      '',
      '| Screen | Anchors | Scenarios |',
      '| --- | ---: | ---: |',
      '| sample | 6 | 1 |',
      '| other | 2 | 0 |',
    ])
  })
  it('says so when no control is left unmarked or declared off', () => {
    const block = renderCoverage(
      { ...MEASURE, unmarked: [], ignored: [] },
      { anchors: 8, codes: 2, screens: 2 },
    )

    expect(block).toContain('### Unmarked\n\nNone.\n\n### Ignored\n\nNone.\n')
  })
})

describe('listControls', () => {
  it('prints the unmarked controls, then the ignored ones with their reasons', () => {
    expect(listControls(MEASURE).split('\n')).toEqual([
      'Unmarked controls: 2',
      'apps/web/src/features/alpha/a.tsx:4: a "home"',
      'packages/ui/src/b.tsx:2: div',
      '',
      'Ignored controls: 1',
      'apps/web/src/features/alpha/a.tsx:6: button "go" — a mouse convenience',
    ])
  })
})
