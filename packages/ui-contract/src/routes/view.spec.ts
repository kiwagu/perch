import { describe, expect, it } from 'vitest'

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
        file: 'contract/screens/sample/$key.yaml',
        example: '/sample/key?tab=a',
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
})
