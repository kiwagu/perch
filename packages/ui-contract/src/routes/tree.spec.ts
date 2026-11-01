import { describe, expect, it } from 'vitest'

import { sampleContract, screenIn } from '../check/contract.fixture'

import { routeTree } from './tree'

describe('routeTree', () => {
  it('puts the frame at the root and every route under it', () => {
    expect(routeTree(sampleContract().screens.screens)).toEqual([
      { path: '__root', screen: 'app-shell', guard: null, parent: null },
      { path: '/sample/$key', screen: 'sample', guard: null, parent: '__root' },
    ])
  })
  it('nests a route under the binding whose path is the longest proper prefix of its segments', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').bindings.push(
      { path: '/sample', roles: ['member'], history: 'push', guard: 'authenticated' },
      { path: '/sample/$key/notes/$note', roles: ['member'], history: 'push' },
      { path: '/samples', roles: ['member'], history: 'push' },
      { path: '/', roles: ['member'], history: 'push' },
    )
    screenIn(contract, 'app-shell').frame = false

    expect(routeTree(contract.screens.screens)).toEqual([
      { path: '__root', screen: null, guard: null, parent: null },
      { path: '/', screen: 'sample', guard: null, parent: '__root' },
      { path: '/sample', screen: 'sample', guard: 'authenticated', parent: '__root' },
      { path: '/sample/$key', screen: 'sample', guard: null, parent: '/sample' },
      { path: '/sample/$key/notes/$note', screen: 'sample', guard: null, parent: '/sample/$key' },
      { path: '/samples', screen: 'sample', guard: null, parent: '__root' },
    ])
  })
})
