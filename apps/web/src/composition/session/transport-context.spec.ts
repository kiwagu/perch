import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import type { EndReason } from '@workspace/replica/sync'

import { memoryStorage } from '../storage'

import { type SessionChannelEvents, sessionTransportContext } from './transport-context'

/** The context of a channel whose events only say which of them was heard. */
function contextHearing() {
  const heard: string[] = []
  const hear = (name: string) => () => {
    heard.push(name)
  }
  const events: SessionChannelEvents = {
    memberships: hear('memberships'),
    refused: hear('refused'),
    revoked: hear('revoked'),
    passwordChanged: hear('passwordChanged'),
    deviceLimit: hear('deviceLimit'),
    banned: hear('banned'),
    protocolRefused: hear('protocolRefused'),
  }

  return {
    heard,
    context: sessionTransportContext(identityIdFactory.create(), memoryStorage(), events),
  }
}

describe('sessionTransportContext', () => {
  it.each<{ readonly reason: EndReason; readonly event: string | undefined }>([
    { reason: 'unauthorized', event: 'refused' },
    { reason: 'revoked', event: 'revoked' },
    { reason: 'password-changed', event: 'passwordChanged' },
    { reason: 'device-limit', event: 'deviceLimit' },
    { reason: 'banned', event: 'banned' },
    { reason: 'protocol', event: 'protocolRefused' },
    // A sign-out this device asked for is heard by the sign-out itself.
    { reason: 'signed-out', event: undefined },
  ])('tells the session of the ending $reason as $event', ({ reason, event }) => {
    const { heard, context } = contextHearing()

    context.onEnded(reason)

    expect(heard).toEqual(event === undefined ? [] : [event])
  })
})
