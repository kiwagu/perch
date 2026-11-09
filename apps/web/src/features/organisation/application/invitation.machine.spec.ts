import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { BusError } from '@workspace/cqrs'

import type { InvitationOnLink } from '../../../platform/invitations.port'

import {
  createInvitationMachine,
  type InvitationEvent,
  type InvitationMachineDeps,
} from './invitation.machine'

const ACCEPT = { type: 'organisation.invitation.accept-button' } as const satisfies InvitationEvent
const DECLINE = {
  type: 'organisation.invitation.decline-button',
} as const satisfies InvitationEvent

const forAnn: InvitationOnLink = { organisation: { name: 'Acme' }, role: 'admin', forYou: true }
const forSomeoneElse: InvitationOnLink = { ...forAnn, role: 'member', forYou: false }

const refused = (code: string) => (): ResultAsync<never, BusError> =>
  errAsync({ code, message: 'refused' })

const never = <T>() => ResultAsync.fromSafePromise<T, BusError>(new Promise<T>(() => {}))

interface Opening {
  readonly read?: () => ResultAsync<InvitationOnLink, BusError>
  /** Whether an account is signed in on the device (Ann, unless nobody is). */
  readonly signedIn?: boolean
  readonly accept?: () => ResultAsync<unknown, BusError>
  readonly decline?: () => ResultAsync<void, BusError>
}

/** The page of the link `the-token`, over a gateway that answers as `opening` says. */
function page(opening: Opening = {}) {
  const {
    read = () => okAsync(forAnn),
    signedIn = true,
    accept = () => okAsync(undefined),
    decline = () => okAsync(undefined),
  } = opening
  const deps = {
    token: 'the-token',
    read: vi.fn((_token: string) => read()),
    accept: vi.fn((_invitation: string) => accept()),
    decline: vi.fn((_invitation: string) => decline()),
    current: () => (signedIn ? 'ann' : undefined),
  } satisfies InvitationMachineDeps
  const actor = createActor(createInvitationMachine(deps)).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, deps, emitted }
}

/** The page once the link was read, asking. */
async function asking(opening: Opening = {}) {
  const opened = page(opening)

  await waitFor(opened.actor, (state) => state.matches('asking'))

  return opened
}

const TO_THE_ORGANISATION = { type: 'navigate', to: '/org' }
const toast = (code: string) => ({
  type: 'show',
  anchor: 'app-shell.toast',
  codes: [code],
})

describe('the invitation page', () => {
  it.each([
    ['signed out', 'signing-in', 'ann', undefined],
    ['signed in', 'elsewhere', undefined, 'ann'],
  ] as const)(
    'asks who is signed in once the read answers: %s meanwhile, it ends in %s',
    async (_change, ends, before, after) => {
      let who: string | undefined = before
      let answer: (link: InvitationOnLink) => void = () => undefined
      const answered = ResultAsync.fromSafePromise<InvitationOnLink, BusError>(
        new Promise((resolve) => {
          answer = resolve
        }),
      )
      const actor = createActor(
        createInvitationMachine({
          token: 'the-token',
          read: () => answered,
          accept: () => okAsync(undefined),
          decline: () => okAsync(undefined),
          current: () => who,
        }),
      ).start()

      expect(actor.getSnapshot().matches('checking')).toBe(true)

      who = after
      answer(forSomeoneElse)

      await waitFor(actor, (state) => state.matches(ends))
    },
  )
  it("checks the address's token first, with nothing taken", () => {
    const { actor, deps } = page({ read: () => never() })

    expect(actor.getSnapshot()).toMatchObject({
      value: 'checking',
      context: { organisation: undefined, role: undefined, error: undefined, message: undefined },
    })
    expect(deps.read).toHaveBeenCalledTimes(1)
    expect(deps.read).toHaveBeenCalledWith('the-token')
    expect(actor.getSnapshot().can(ACCEPT)).toBe(false)
    expect(actor.getSnapshot().can(DECLINE)).toBe(false)
  })

  it('asks the account the invitation is for, with the organisation and the role', async () => {
    const { actor } = await asking()
    const state = actor.getSnapshot()

    expect(state.context).toEqual({
      organisation: 'Acme',
      role: 'admin',
      error: undefined,
      message: undefined,
    })
    expect(state.can(ACCEPT)).toBe(true)
    expect(state.can(DECLINE)).toBe(true)
  })

  it('tells nobody signed in here to sign in to the account, offering nothing', async () => {
    const { actor, emitted } = page({ read: () => okAsync(forSomeoneElse), signedIn: false })
    const state = await waitFor(actor, (each) => each.matches('signing-in'))

    expect(state.status).toBe('done')
    expect(state.context).toEqual({
      organisation: 'Acme',
      role: 'member',
      error: undefined,
      message: 'sign-in-to-accept',
    })
    expect(state.can(ACCEPT)).toBe(false)
    expect(state.can(DECLINE)).toBe(false)
    expect(emitted).toEqual([])
  })

  it('tells another account signed in here that the invitation is not for it, offering nothing', async () => {
    const { actor } = page({ read: () => okAsync(forSomeoneElse) })
    const state = await waitFor(actor, (each) => each.matches('elsewhere'))

    expect(state.status).toBe('done')
    expect(state.context).toEqual({
      organisation: 'Acme',
      role: 'member',
      error: 'other-account',
      message: undefined,
    })
    expect(state.can(ACCEPT)).toBe(false)
    expect(state.can(DECLINE)).toBe(false)
  })

  it.each(['link-invalid', 'link-expired'])(
    'ends on a link that does not work, with its error: %s',
    async (code) => {
      const { actor } = page({ read: refused(code) })
      const state = await waitFor(actor, (each) => each.matches('link-dead'))

      expect(state.status).toBe('done')
      expect(state.context).toEqual({
        organisation: undefined,
        role: undefined,
        error: code,
        message: undefined,
      })
      expect(state.can(ACCEPT)).toBe(false)
    },
  )

  it.each([
    ['rate-limited', 'rate-limited'],
    ['failed', 'failed'],
    ['data:OFFLINE', 'failed'],
    ['invitation-gone', 'failed'],
  ])('ends on a link it could not read, saying why: %s shows %s', async (code, shown) => {
    const { actor } = page({ read: refused(code) })
    const state = await waitFor(actor, (each) => each.matches('unread'))

    expect(state.status).toBe('done')
    expect(state.context.error).toBe(shown)
    expect(state.can(ACCEPT)).toBe(false)
  })

  describe('accepting', () => {
    it("accepts with the address's token, then moves to the organisation page, saying so", async () => {
      const { actor, deps, emitted } = await asking()

      actor.send(ACCEPT)

      const joined = await waitFor(actor, (state) => state.matches('joined'))

      expect(deps.accept).toHaveBeenCalledTimes(1)
      expect(deps.accept).toHaveBeenCalledWith('the-token')
      expect(deps.decline).not.toHaveBeenCalled()
      expect(joined.status).toBe('done')
      expect(joined.context.error).toBeUndefined()
      expect(emitted).toEqual([TO_THE_ORGANISATION, toast('invitation-accepted')])
    })

    it('takes no more presses while it runs', async () => {
      const { actor, deps } = await asking({ accept: () => never() })

      actor.send(ACCEPT)

      expect(actor.getSnapshot().value).toBe('accepting')
      expect(actor.getSnapshot().can(ACCEPT)).toBe(false)
      expect(actor.getSnapshot().can(DECLINE)).toBe(false)

      actor.send(ACCEPT)
      actor.send(DECLINE)

      expect(deps.accept).toHaveBeenCalledTimes(1)
      expect(deps.decline).not.toHaveBeenCalled()
    })

    it('ends on a link that does not work when the invitation is gone meanwhile', async () => {
      const { actor, emitted } = await asking({ accept: refused('invitation-gone') })

      actor.send(ACCEPT)

      const dead = await waitFor(actor, (state) => state.matches('link-dead'))

      expect(dead.status).toBe('done')
      expect(dead.context.error).toBe('invitation-gone')
      expect(emitted).toEqual([])
    })

    it.each([
      ['already-member', 'already-member'],
      ['other-account', 'other-account'],
      ['failed', 'failed'],
      ['data:OFFLINE', 'failed'],
      ['link-invalid', 'failed'],
    ])('asks again with the error and the buttons back: %s shows %s', async (code, shown) => {
      const { actor, emitted } = await asking({ accept: refused(code) })

      actor.send(ACCEPT)

      const again = await waitFor(
        actor,
        (state) => state.matches('asking') && state.context.error !== undefined,
      )

      expect(again.context).toMatchObject({ organisation: 'Acme', role: 'admin', error: shown })
      expect(again.can(ACCEPT)).toBe(true)
      expect(again.can(DECLINE)).toBe(true)
      expect(emitted).toEqual([])
    })

    it('clears the error of a refusal when it is pressed again', async () => {
      const answers = [refused('already-member'), () => never<unknown>()]
      let asked = 0
      const { actor } = await asking({
        accept: () => (answers[Math.min(asked++, 1)] ?? expect.unreachable('an answer'))(),
      })

      actor.send(ACCEPT)
      await waitFor(actor, (state) => state.context.error === 'already-member')
      actor.send(ACCEPT)

      expect(actor.getSnapshot().value).toBe('accepting')
      expect(actor.getSnapshot().context.error).toBeUndefined()
    })
  })

  describe('declining', () => {
    it("declines with the address's token, then moves to the organisation page, saying so", async () => {
      const { actor, deps, emitted } = await asking()

      actor.send(DECLINE)

      const declined = await waitFor(actor, (state) => state.matches('declined'))

      expect(deps.decline).toHaveBeenCalledTimes(1)
      expect(deps.decline).toHaveBeenCalledWith('the-token')
      expect(deps.accept).not.toHaveBeenCalled()
      expect(declined.status).toBe('done')
      expect(emitted).toEqual([TO_THE_ORGANISATION, toast('invitation-declined')])
    })

    it('takes no more presses while it runs', async () => {
      const { actor, deps } = await asking({ decline: () => never() })

      actor.send(DECLINE)

      expect(actor.getSnapshot().value).toBe('declining')
      expect(actor.getSnapshot().can(ACCEPT)).toBe(false)
      expect(actor.getSnapshot().can(DECLINE)).toBe(false)

      actor.send(ACCEPT)
      actor.send(DECLINE)

      expect(deps.decline).toHaveBeenCalledTimes(1)
      expect(deps.accept).not.toHaveBeenCalled()
    })

    it('ends on a link that does not work when the invitation is gone meanwhile', async () => {
      const { actor, emitted } = await asking({ decline: refused('invitation-gone') })

      actor.send(DECLINE)

      const dead = await waitFor(actor, (state) => state.matches('link-dead'))

      expect(dead.context.error).toBe('invitation-gone')
      expect(emitted).toEqual([])
    })

    it.each([
      ['other-account', 'other-account'],
      ['failed', 'failed'],
      ['data:OFFLINE', 'failed'],
      ['already-member', 'failed'],
    ])('asks again with the error and the buttons back: %s shows %s', async (code, shown) => {
      const { actor } = await asking({ decline: refused(code) })

      actor.send(DECLINE)

      const again = await waitFor(
        actor,
        (state) => state.matches('asking') && state.context.error !== undefined,
      )

      expect(again.context.error).toBe(shown)
      expect(again.can(ACCEPT)).toBe(true)
      expect(again.can(DECLINE)).toBe(true)
    })
  })
})
