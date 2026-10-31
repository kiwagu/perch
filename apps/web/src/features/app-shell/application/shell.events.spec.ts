import { describe, expect, it } from 'vitest'

import { EventBus } from '@workspace/cqrs'

import type { AppEvent } from '../../../platform/events.port'

import { shellEvents } from './shell.events'

const rejection = {
  region: 'identity:idn_1',
  batch: 3,
  reason: 'foreign-table',
  detail: "the table is not the region's",
  reloaded: false,
}
const at = { actorId: 'idn_1', occurredAt: new Date(0) }

describe('shellEvents', () => {
  it("sends the frame's machine the three refusals of the bus, until it stops", async () => {
    const bus = new EventBus<AppEvent>()
    const sent: unknown[] = []
    const stop = shellEvents(bus, { send: (event) => sent.push(event) })

    expect(
      (await bus.publish([{ name: 'sync.change-rejected', payload: rejection, ...at }])).isOk(),
    ).toBe(true)
    expect(
      (
        await bus.publish([
          { name: 'sync.changes-reloaded', payload: { ...rejection, reloaded: true }, ...at },
        ])
      ).isOk(),
    ).toBe(true)
    expect(
      (await bus.publish([{ name: 'sync.protocol-refused', payload: null, ...at }])).isOk(),
    ).toBe(true)

    stop()

    expect(
      (await bus.publish([{ name: 'sync.change-rejected', payload: rejection, ...at }])).isOk(),
    ).toBe(true)
    expect(sent).toEqual([
      { type: 'platform.change-rejected' },
      { type: 'platform.changes-reloaded' },
      { type: 'platform.protocol-refused' },
    ])
  })
})
