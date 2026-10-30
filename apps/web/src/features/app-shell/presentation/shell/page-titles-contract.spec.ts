/**
 * Every screen of the contract has its page title: each binding's path is worded with the key of
 * its screen, `app.title.<screen id>`, which both catalogs word. On a branch the pre-commit hook
 * sets `CONTRACT_AHEAD=1`: a business commit may add a screen before its title, so a binding may
 * wait for its title, while a title never names a path the contract does not bind; `bun run
 * check` and `main` want every binding titled.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens } from '@workspace/ui-contract'

import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'

import { PAGE_TITLES } from './page-title'

const ROOT = join(import.meta.dirname, '../../../../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

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

    const titled = bindings.filter(({ path }) => !AHEAD || Object.hasOwn(PAGE_TITLES, path))

    expect(
      Object.fromEntries(Object.entries(PAGE_TITLES).map(([path, title]) => [path, title(key)])),
    ).toEqual(Object.fromEntries(titled.map(({ screen, path }) => [path, `app.title.${screen}`])))

    for (const { screen } of titled) {
      expect(Object.hasOwn(en, `app.title.${screen}`), `en words app.title.${screen}`).toBe(true)
      expect(Object.hasOwn(es, `app.title.${screen}`), `es words app.title.${screen}`).toBe(true)
    }
  })
})
