import { describe, expect, it } from 'vitest'
import { assign, createActor, setup } from 'xstate'

import type { PlatformEvent, PlatformEventsPort } from './platform-events.port'
import { sendPlatformEvents } from './platform-events-input'

/** The platform's events as a test tells them. */
function platform() {
  const listeners = new Set<(event: PlatformEvent) => void>()
  const port: PlatformEventsPort = {
    listen: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }

  return {
    port,
    tell: (event: PlatformEvent) => {
      for (const listener of listeners) {
        listener(event)
      }
    },
  }
}

/** A machine that counts the theme events it heard and keeps the fields the last one carried. */
const listening = setup({
  types: {
    context: {} as { readonly heard: number; readonly fields: unknown },
    events: {} as
      | { readonly type: 'platform.theme-set'; readonly fields?: unknown }
      | { readonly type: 'end' },
  },
}).createMachine({
  context: { heard: 0, fields: undefined },
  initial: 'on',
  states: {
    on: {
      on: {
        'platform.theme-set': {
          actions: assign({
            heard: ({ context }) => context.heard + 1,
            fields: ({ event }) => event.fields,
          }),
        },
        end: { target: 'done' },
      },
    },
    done: { type: 'final' },
  },
})

describe('sendPlatformEvents', () => {
  it('sends each event to the running machine, a state that does not handle one letting it pass', () => {
    const events = platform()
    const actor = createActor(listening).start()

    sendPlatformEvents(events.port, actor)
    events.tell({ type: 'platform.theme-set' })
    events.tell({ type: 'platform.password-reset' })
    events.tell({ type: 'platform.theme-set' })

    expect(actor.getSnapshot().context).toEqual({ heard: 2, fields: undefined })
  })

  it('carries the fields given as each event comes', () => {
    const events = platform()
    const actor = createActor(listening).start()
    let fields = { 'user.sign-in.email-input': 'ann@example.test' }

    sendPlatformEvents(events.port, actor, () => fields)
    fields = { 'user.sign-in.email-input': 'bob@example.test' }
    events.tell({ type: 'platform.theme-set' })

    expect(actor.getSnapshot().context.fields).toEqual({
      'user.sign-in.email-input': 'bob@example.test',
    })
  })

  it('sends nothing to a machine that ended, nor once stopped', () => {
    const events = platform()
    const ended = createActor(listening).start()

    sendPlatformEvents(events.port, ended)
    ended.send({ type: 'end' })
    events.tell({ type: 'platform.theme-set' })

    expect(ended.getSnapshot().context.heard).toBe(0)

    const stopped = createActor(listening).start()
    const stop = sendPlatformEvents(events.port, stopped)

    stop()
    events.tell({ type: 'platform.theme-set' })

    expect(stopped.getSnapshot().context.heard).toBe(0)
  })
})
