/**
 * Every screen of the contract has its page title: each binding's path is worded with the key of
 * its screen, `app.title.<screen id>`, which both catalogs word.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens } from '@workspace/ui-contract'

import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'

import { PAGE_TITLES } from './page-title'

const ROOT = join(import.meta.dirname, '../../../../../../..')

describe('the page titles of the contract', () => {
  const { screens, problems } = loadScreens(ROOT)
  const bindings = (screens?.screens ?? [])
    .filter((screen) => screen.frame !== true)
    .flatMap((screen) =>
      screen.bindings.map((binding) => ({ screen: screen.id, path: binding.path })),
    )

  it('load without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(bindings.length).toBeGreaterThan(0)
  })

  it('word every binding with the key of its screen, in both catalogs', () => {
    const key = (text: string) => text

    expect(
      Object.fromEntries(Object.entries(PAGE_TITLES).map(([path, title]) => [path, title(key)])),
    ).toEqual(Object.fromEntries(bindings.map(({ screen, path }) => [path, `app.title.${screen}`])))

    for (const { screen } of bindings) {
      expect(Object.hasOwn(en, `app.title.${screen}`), `en words app.title.${screen}`).toBe(true)
      expect(Object.hasOwn(es, `app.title.${screen}`), `es words app.title.${screen}`).toBe(true)
    }
  })
})
