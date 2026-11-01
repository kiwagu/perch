import { describe, expect, it } from 'vitest'

import { sampleContract, screenIn } from '../check/contract.fixture'
import { fixtureContract } from '../manifest/manifest.fixture'

import { renderRoutes } from './render'
import { routesOf } from './view'

describe('renderRoutes', () => {
  it('prints the table, the example links, where each route is reached from and the tree', () => {
    expect(renderRoutes(routesOf(fixtureContract()))).toBe(
      [
        'path          screen  guard          roles   history  params  search  file',
        '/sample/$key  sample  authenticated  member  push     key     -       contract/domain/screens/sample/$key.yaml',
        '',
        'example links (parameters from examples, search from defaults)',
        "(every search key at its default on purpose; the app's own links leave a default out, the same state)",
        '/sample/$key  /sample/thg_01hzx9k2',
        '',
        'reached from',
        '/sample/$key  links: -   navigate: sample   activities: thing.editing, thing.saved',
        '',
        'tree',
        '__root',
        '  /sample/$key  -> sample  [authenticated]',
      ].join('\n'),
    )
  })
  it('names the frame at the root and indents a nested route under its parent', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').bindings.push({
      path: '/sample',
      roles: ['member'],
      history: 'push',
    })

    expect(renderRoutes(routesOf(contract)).split('\n').slice(-3)).toEqual([
      '__root (app-shell)',
      '  /sample         -> sample  [-]',
      '    /sample/$key  -> sample  [-]',
    ])
  })
})
