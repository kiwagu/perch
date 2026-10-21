import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MODEL_FILE, SCREENS_FILE, VOCABULARY_FILE } from '../files'
import { repository, useRepositories } from '../repository.fixture'

import { measureCoverage, renderCoverage } from './coverage'

useRepositories()

const FIXTURES = join(import.meta.dirname, '../__fixtures__')

const sample = (): string =>
  repository({
    [VOCABULARY_FILE]: readFileSync(join(FIXTURES, 'vocabulary.md'), 'utf8'),
    [SCREENS_FILE]: readFileSync(join(FIXTURES, 'screens.json'), 'utf8'),
    [MODEL_FILE]: readFileSync(join(FIXTURES, 'model.schema.json'), 'utf8'),
    'apps/web/src/features/alpha/presentation/alpha.view.tsx':
      'export const A = () => (\n  <form>\n    <Button data-testid="sample.save-button">Save</Button>\n    <a href="/">home</a>\n  </form>\n)\n',
    'apps/web/src/features/alpha/presentation/alpha.view.spec.tsx':
      'export const T = () => <button>test</button>\n',
    'apps/web/src/features/beta/README.md': '# Beta\n',
    'apps/web/src/platform/shell.tsx': 'export const S = () => <button>outside</button>\n',
    'packages/ui/src/components/ui/button.tsx':
      'export const B = (props: P) => (\n  <div onClick={props.go}>\n    <button {...props} />\n  </div>\n)\n',
  })

describe('measureCoverage', () => {
  it('counts the controls of each feature module and of the kit, without tests', () => {
    expect(measureCoverage(sample()).modules).toEqual([
      { module: 'alpha', controls: 2, marked: 1 },
      { module: 'beta', controls: 0, marked: 0 },
      { module: 'ui kit', controls: 1, marked: 0 },
    ])
  })
  it('counts the anchors of each screen and the scenarios that reach it', () => {
    expect(measureCoverage(sample()).screens).toEqual([{ id: 'sample', anchors: 6, scenarios: 1 }])
  })
})

describe('renderCoverage', () => {
  const measure = {
    modules: [
      { module: 'alpha', controls: 3, marked: 2 },
      { module: 'beta', controls: 0, marked: 0 },
      { module: 'ui kit', controls: 1, marked: 0 },
    ],
    screens: [
      { id: 'sample', anchors: 6, scenarios: 1 },
      { id: 'other', anchors: 2, scenarios: 0 },
    ],
  }

  it('prints the totals, a row per module with its share and the screens', () => {
    expect(renderCoverage(measure, { anchors: 8, codes: 2, screens: 2 }).split('\n')).toEqual([
      'The contract declares 2 screens, 8 anchors and 2 codes.',
      '',
      '| Module | Controls | Marked | Share |',
      '| --- | ---: | ---: | ---: |',
      '| alpha | 3 | 2 | 67% |',
      '| beta | 0 | 0 | - |',
      '| ui kit | 1 | 0 | 0% |',
      '| all | 4 | 2 | 50% |',
      '',
      '| Screen | Anchors | Scenarios |',
      '| --- | ---: | ---: |',
      '| sample | 6 | 1 |',
      '| other | 2 | 0 |',
    ])
  })
})
