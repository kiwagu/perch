import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, MODEL_FILE, PLATFORM_FILE, scenarioFile, VOCABULARY_FILE } from '../files'
import { repository, useRepositories } from '../repository.fixture'
import { IGNORE_WITHOUT_REASON } from '../sources'

import { measureCoverage } from './coverage'

useRepositories()

const FIXTURES = join(import.meta.dirname, '../__fixtures__')
const SCENARIO = 'sample/base/thing'
const SCREEN = 'contract/screens/sample/$key.yaml'
const ACTIVITY = 'contract/activities/thing.yaml'
const ALPHA = 'apps/web/src/features/alpha/presentation/alpha.view.tsx'
const KIT = 'packages/ui/src/components/ui/button.tsx'

const sample = (sources: Readonly<Record<string, string>> = {}): string =>
  repository({
    [VOCABULARY_FILE]: readFileSync(join(FIXTURES, 'vocabulary.md'), 'utf8'),
    [SCREEN]: readFileSync(join(FIXTURES, SCREEN), 'utf8'),
    [ACTIVITY]: readFileSync(join(FIXTURES, ACTIVITY), 'utf8'),
    [PLATFORM_FILE]: readFileSync(join(FIXTURES, PLATFORM_FILE), 'utf8'),
    [MODEL_FILE]: readFileSync(join(FIXTURES, 'model.schema.json'), 'utf8'),
    [scenarioFile(SCENARIO)]: readFileSync(join(FIXTURES, scenarioFile(SCENARIO)), 'utf8'),
    [ALPHA]:
      'export const A = () => (\n  <form>\n    <Button data-testid="sample.save-button">Save</Button>\n    <a href="/">home</a>\n    {/* ui-contract-ignore: a mouse convenience */}\n    <button onClick={go}>go</button>\n  </form>\n)\n',
    'apps/web/src/features/alpha/presentation/alpha.view.spec.tsx':
      'export const T = () => <button>test</button>\n',
    'apps/web/src/features/beta/README.md': '# Beta\n',
    'apps/web/src/platform/shell.tsx': 'export const S = () => <button>outside</button>\n',
    [KIT]:
      'export const B = (props: P) => (\n  <div onClick={props.go}>\n    <button {...props} />\n  </div>\n)\n',
    ...sources,
  })

describe('measureCoverage', () => {
  it('counts the controls of each feature module and of the kit, without tests', () => {
    expect(measureCoverage(sample()).modules).toEqual([
      { module: 'alpha', controls: 2, marked: 1, ignored: 1 },
      { module: 'beta', controls: 0, marked: 0, ignored: 0 },
      { module: 'ui kit', controls: 1, marked: 0, ignored: 0 },
    ])
  })
  it('lists the unmarked and the ignored controls by file and line', () => {
    const { unmarked, ignored, problems } = measureCoverage(sample())

    expect(unmarked).toEqual([
      { file: ALPHA, line: 4, tag: 'a', label: 'home' },
      { file: KIT, line: 2, tag: 'div' },
    ])
    expect(ignored).toEqual([
      { file: ALPHA, line: 6, tag: 'button', label: 'go', reason: 'a mouse convenience' },
    ])
    expect(problems).toEqual([])
  })
  it('returns the markers it cannot apply as problems', () => {
    const broken = 'apps/web/src/features/beta/beta.view.tsx'
    const { problems } = measureCoverage(
      sample({
        [broken]:
          'export const B = () => (\n  <>\n    {/* ui-contract-ignore: */}\n    <a href="/">b</a>\n  </>\n)\n',
      }),
    )

    expect(problems.map(formatProblem)).toEqual([`${broken}:3: ${IGNORE_WITHOUT_REASON}`])
  })
  it('lists each field and action of the model with the anchors bound to it', () => {
    expect(measureCoverage(sample()).model).toEqual([
      {
        entity: 'thing',
        fields: [
          { name: 'id', anchors: [] },
          { name: 'author', anchors: [] },
          { name: 'title', anchors: ['sample.title-input'] },
          { name: 'size', anchors: [] },
          { name: 'created_at', anchors: [] },
        ],
        actions: [
          { name: 'createThing', anchors: ['sample.save-button'] },
          { name: 'updateThing', anchors: ['sample.save-button'] },
        ],
      },
    ])
  })
  it('counts per activity the scenarios that name it and the transitions they walk in a step', () => {
    const fixture = readFileSync(join(FIXTURES, scenarioFile(SCENARIO)), 'utf8')
    const walking = fixture
      .replaceAll('[/sample]', '[/sample/$key]')
      .replace('[sample.title-input]', '$& and click [sample.save-button]')

    expect(measureCoverage(sample()).activities).toEqual([
      { id: 'thing', scenarios: 1, transitions: 1, walked: 0 },
    ])
    expect(measureCoverage(sample({ [scenarioFile(SCENARIO)]: walking })).activities).toEqual([
      { id: 'thing', scenarios: 1, transitions: 1, walked: 1 },
    ])
  })
  it('walks a scenario in the order of its file, whatever the order of its sections', () => {
    const header = '---\ntags:\n  - smoke\nactivity: thing\ndevices:\n  A: member\ndata: {}\n---\n'
    const intro = '# Edit the thing\n\nWhere: [/sample/$key]\n\n## Scenario: A member saves\n\n'
    const steps = '### Steps\n1. Click [sample.save-button]\n\n'
    const expected = '### Expected result\n- The page is on [/elsewhere]\n\n'
    const walked = (body: string): number[] =>
      measureCoverage(
        sample({ [scenarioFile(SCENARIO)]: `${header}${intro}${body}` }),
      ).activities.map(({ walked }) => walked)

    expect(walked(`${steps}${expected}`)).toEqual([1])
    expect(walked(`${expected}${steps}`)).toEqual([0])
  })
  it('counts the anchors of each screen and the scenarios that reach it', () => {
    expect(measureCoverage(sample()).screens).toEqual([{ id: 'sample', anchors: 6, scenarios: 1 }])
  })
})
