import { describe, expect, it } from 'vitest'

import {
  clientMessage,
  decodeMessage,
  encodeMessage,
  type ServerMessage,
  serverMessage,
} from './protocol'

describe('sync protocol', () => {
  it('carries Loro bytes through JSON and back', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const text = encodeMessage(clientMessage, {
      type: 'push',
      region: 'identity:idn_a',
      batch: 7,
      updates: [bytes],
    })

    const decoded = decodeMessage(clientMessage, text)._unsafeUnwrap()

    expect(decoded).toEqual({ type: 'push', region: 'identity:idn_a', batch: 7, updates: [bytes] })
  })

  it('refuses a message of an unknown type', () => {
    expect(decodeMessage(clientMessage, '{"type":"drop-table"}').isErr()).toBe(true)
  })

  it('refuses bytes that are not base64', () => {
    const text = '{"type":"pull","region":"identity:idn_a","vv":"***"}'

    expect(decodeMessage(clientMessage, text).isErr()).toBe(true)
  })

  it('refuses a push of more updates than one batch may hold', () => {
    const updates = Array.from({ length: 257 }, () => 'AA==')
    const text = JSON.stringify({ type: 'push', region: 'identity:idn_a', batch: 1, updates })

    expect(decodeMessage(clientMessage, text).isErr()).toBe(true)
  })

  it('refuses text that is not JSON', () => {
    expect(decodeMessage(serverMessage, 'not json').isErr()).toBe(true)
  })

  it('round-trips every server message', () => {
    const bytes = new Uint8Array([9])
    const messages: ServerMessage[] = [
      {
        type: 'welcome',
        identity: 'idn_a',
        regions: [{ region: 'identity:idn_a', head: 0 }],
        time: 1,
      },
      { type: 'tokens', access: 'a', refresh: 'r' },
      { type: 'updates', region: 'identity:idn_a', bytes, head: 3, snapshot: false },
      { type: 'ack', region: 'identity:idn_a', batch: 2, head: 4, compact: false },
      {
        type: 'reject',
        region: 'identity:idn_a',
        batch: 2,
        reason: 'foreign-table',
        detail: 'note',
      },
      { type: 'heads', regions: [{ region: 'identity:idn_a', head: 4 }], time: 2 },
      { type: 'compaction', region: 'identity:idn_a', covers: 4, outcome: 'accepted' },
      { type: 'error', code: 'protocol', message: 'bad' },
    ]

    for (const message of messages) {
      expect(
        decodeMessage(serverMessage, encodeMessage(serverMessage, message))._unsafeUnwrap(),
      ).toEqual(message)
    }
  })
})
