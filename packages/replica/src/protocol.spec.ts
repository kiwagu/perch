import { describe, expect, it } from 'vitest'

import {
  CLOSE,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type Membership,
  membership,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from './protocol'

const acme: Membership = { tenant: { id: 'tnt_a', key: 'acme', name: 'Acme' }, role: 'admin' }

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

  it('takes a hello of protocol 7 only', () => {
    const hello = (protocol: number) =>
      JSON.stringify({ type: 'hello', protocol, token: 't', device: 'd' })

    expect(PROTOCOL_VERSION).toBe(7)
    expect(decodeMessage(clientMessage, hello(7)).isOk()).toBe(true)
    expect(decodeMessage(clientMessage, hello(6)).isErr()).toBe(true)
  })

  it('takes a hello that carries the session token, and no access or refresh key', () => {
    const hello = (fields: object) =>
      JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, device: 'd', ...fields })

    expect(decodeMessage(clientMessage, hello({ token: 't' }))._unsafeUnwrap()).toEqual({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      token: 't',
      device: 'd',
    })
    expect(decodeMessage(clientMessage, hello({ access: 'a' })).isErr()).toBe(true)
    expect(decodeMessage(clientMessage, hello({ access: 'a', refresh: 'r' })).isErr()).toBe(true)
    expect(decodeMessage(clientMessage, hello({})).isErr()).toBe(true)
    expect(decodeMessage(clientMessage, hello({ token: '' })).isErr()).toBe(true)
  })

  it('refuses a renew: a session token is never renewed by the client', () => {
    expect(decodeMessage(clientMessage, JSON.stringify({ type: 'renew' })).isErr()).toBe(true)
  })

  it('refuses a tokens message: the gateway sends no renewed keys', () => {
    const text = JSON.stringify({ type: 'tokens', access: 'a', refresh: 'r' })

    expect(decodeMessage(serverMessage, text).isErr()).toBe(true)
  })

  it("decodes a reject that names a batch under another identity's peer", () => {
    const reject: ServerMessage = {
      type: 'reject',
      region: 'tenant:acme',
      batch: 3,
      reason: 'foreign-peer',
      detail: 'peer: 42 writes as another identity in tenant:acme',
    }

    expect(
      decodeMessage(serverMessage, encodeMessage(serverMessage, reject))._unsafeUnwrap(),
    ).toEqual(reject)
  })

  it('takes a hello that names its device in 1 to 64 characters', () => {
    const hello = (device: string) =>
      JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: 't', device })

    expect(decodeMessage(clientMessage, hello('d'.repeat(64)))._unsafeUnwrap()).toEqual({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      token: 't',
      device: 'd'.repeat(64),
    })
    expect(decodeMessage(clientMessage, hello('')).isErr()).toBe(true)
    expect(decodeMessage(clientMessage, hello('d'.repeat(65))).isErr()).toBe(true)
  })

  it('refuses a hello that names no device', () => {
    const hello = JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: 't' })

    expect(decodeMessage(clientMessage, hello).isErr()).toBe(true)
  })

  it('closes a device signed out from another one with 4001', () => {
    expect(CLOSE.revoked).toBe(4001)
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
        regions: [
          { region: 'identity:idn_a', head: 0 },
          { region: 'tenant:acme', head: 2 },
        ],
        memberships: [acme],
        time: 1,
      },
      { type: 'memberships', memberships: [acme] },
      { type: 'memberships', memberships: [] },
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

  it('parses a membership and refuses a role it does not know', () => {
    expect(membership.parse(acme)).toEqual(acme)
    expect(membership.safeParse({ ...acme, role: 'owner' }).success).toBe(false)
  })
})
