import { describe, expect, it } from 'vitest'

import { outcomeOf } from './outcome'

describe('what a step of signing in answered', () => {
  const user = { id: 'idn_ann', email: 'ann@example.test' }

  it.each([
    [{ kind: 'signed-in', user }],
    [{ kind: 'code-required', challenge: 'challenge-1', email: 'ann@example.test' }],
  ])('is read off the output of the done event: %j', (output) => {
    expect(outcomeOf({ type: 'xstate.done.actor.0', output })).toEqual(output)
  })

  it.each([
    ['an event with no output', { type: 'user.sign-in.passkey-button' }],
    ['an output of no kind', { type: 'xstate.done.actor.0', output: { user } }],
    ['an output of another kind', { type: 'xstate.done.actor.0', output: { kind: 'other' } }],
    ['an output that is not an object', { type: 'xstate.done.actor.0', output: 'device-limit' }],
    [
      'a refusal at the limit of devices, which is no outcome',
      { type: 'xstate.done.actor.0', output: { kind: 'device-limit', consentFor: 'idn_ann' } },
    ],
    ['a failure', { type: 'xstate.error.actor.0', error: { code: 'data:AUTH_FAILED' } }],
  ])('is none for %s', (_, event) => {
    expect(outcomeOf(event)).toBeUndefined()
  })
})
