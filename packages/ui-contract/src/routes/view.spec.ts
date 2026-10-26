import { describe, expect, it } from 'vitest'

import { parallelIn, regionStateIn, withAreas } from '../check/areas.fixture'
import { sampleContract, screenIn } from '../check/contract.fixture'

import { routesOf } from './view'

describe('routesOf', () => {
  it('gives each binding its row, its example link and where it is reached from', () => {
    expect(routesOf(sampleContract()).routes).toEqual([
      {
        path: '/sample/$key',
        screen: 'sample',
        guard: null,
        roles: ['member'],
        history: 'push',
        params: ['key'],
        search: ['tab'],
        file: 'contract/domain/screens/sample/$key.yaml',
        example: '/sample/a?tab=a',
        reachedFrom: {
          links: ['sample.home-link'],
          navigate: ['sample'],
          activities: ['thing.editing', 'thing.saved', 'thing.home'],
        },
      },
    ])
  })
  it('sorts the rows by path and names a screen once per route it navigates to', () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')

    sample.bindings.push({ path: '/about', roles: ['guest'], history: 'replace' })
    screenIn(contract, 'app-shell').flow = {
      initial: 'open',
      states: {
        open: {
          entry: [{ type: 'navigate', params: { to: '/about' } }],
          on: { 'app-shell.status': { actions: [{ type: 'navigate', params: { to: '/about' } }] } },
        },
      },
    }

    const { routes } = routesOf(contract)

    expect(routes.map(({ path }) => path)).toEqual(['/about', '/sample/$key'])
    expect(routes[0]?.reachedFrom).toEqual({ links: [], navigate: ['app-shell'], activities: [] })
  })
  it('names a screen whose parallel state or a state of its regions navigates to the route', () => {
    const contract = withAreas()
    const to = (path: string) => [{ type: 'navigate', params: { to: path } }] as const

    screenIn(contract, 'sample').bindings.push(
      { path: '/about', roles: ['guest'], history: 'replace' },
      { path: '/help', roles: ['guest'], history: 'replace' },
    )
    parallelIn(contract).entry = [...to('/help')]
    regionStateIn(contract, 'form', 'open').exit = [...to('/about')]

    expect(
      routesOf(contract).routes.map(({ path, reachedFrom }) => [path, reachedFrom.navigate]),
    ).toEqual([
      ['/about', ['sample']],
      ['/help', ['sample']],
      ['/sample/$key', ['sample']],
    ])
  })
})
