import { describe, expect, it } from 'vitest'

import { screenFileSchema } from '../../schemas'
import type { Screen } from '../screens'

import { searchTakersOf } from './search-takers'

/** A state that runs `src` with the search parameter `token` as the parameter `param`. */
const invoking = (src: string, param = 'token') => ({
  invoke: { src, input: { [param]: { search: 'token' } }, onDone: { target: 'done' } },
})

/** A screen whose flow starts in `initial`, its `states` in the order given, and whose anchors are `anchors`. */
function screenOf(
  initial: string,
  states: Record<string, unknown>,
  anchors: Record<string, unknown> = {},
): Screen {
  return screenFileSchema.parse({
    id: 'landing',
    title: 'Landing',
    description: 'What a link opens.',
    flag: null,
    bindings: [{ path: '/landing', roles: ['guest'] }],
    entry: ['landing.page'],
    anchors: { 'landing.page': { kind: 'page' }, ...anchors },
    flow: { initial, states: { ...states, done: { type: 'final' } } },
  })
}

const actionsOf = (screen: Screen, name = 'token') =>
  searchTakersOf(screen, name).map(({ action, param }) => `${action} ${param}`)

const sourced = (platform: string) => ({
  'landing.entries-list': {
    kind: 'list',
    source: { platform, params: { token: { search: 'token' } } },
  },
})

describe('searchTakersOf', () => {
  it('lists the invoke of the initial state first, however late the file writes it', () => {
    const screen = screenOf('opening', {
      first: invoking('platform.first'),
      second: invoking('platform.second'),
      opening: invoking('platform.open'),
    })

    expect(actionsOf(screen)).toEqual([
      'platform.open token',
      'platform.first token',
      'platform.second token',
    ])
  })
  it('lists the other states as the file writes them, when the initial state invokes nothing', () => {
    const screen = screenOf('idle', {
      first: invoking('platform.first'),
      idle: { on: { 'landing.go-button': { target: 'second' } } },
      second: invoking('platform.second'),
    })

    expect(actionsOf(screen)).toEqual(['platform.first token', 'platform.second token'])
  })
  it('lists the states of the regions of an initial parallel state before the other states', () => {
    const screen = screenOf('viewing', {
      first: invoking('platform.first'),
      viewing: {
        type: 'parallel',
        states: {
          form: { initial: 'closed', states: { closed: {}, open: {} } },
          notes: {
            initial: 'idle',
            states: { idle: {}, adding: invoking('platform.add') },
          },
        },
      },
    })

    expect(actionsOf(screen)).toEqual(['platform.add token', 'platform.first token'])
  })
  it('lists the sources of the lists after every invoke, and each parameter of an action once', () => {
    const screen = screenOf(
      'opening',
      { first: invoking('platform.first'), opening: invoking('platform.first') },
      sourced('read'),
    )

    expect(actionsOf(screen)).toEqual(['platform.first token', 'platform.read token'])
  })
  it('lists nothing for a parameter no action of the screen takes', () => {
    expect(actionsOf(screenOf('opening', { opening: invoking('platform.open') }), 'other')).toEqual(
      [],
    )
  })
})
