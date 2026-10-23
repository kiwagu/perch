import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import { type DataError, dataError } from '@workspace/data'
import type { ProfileId } from '@workspace/ids'

import { createProfileMachine, type ProfileFields } from './profile.machine'

const id = 'prf_0000000000000000.01m52pexcp' as ProfileId

type Field = keyof ProfileFields
type Saved = ResultAsync<void, BusError>
type SignedOut = ResultAsync<'signed-out' | 'needs-confirmation', DataError>

const INPUT = { name: 'user.profile.name-input', bio: 'user.profile.bio-textarea' } as const
const DATA = { name: 'model.profile.name', bio: 'model.profile.bio' } as const

/** A profile page: the stored profile, what the inputs hold, and the machine over them. */
function page(
  options: {
    readonly updateName?: () => Saved
    readonly updateBio?: () => Saved
    readonly signOut?: () => SignedOut
  } = {},
) {
  let stored: ProfileFields = { name: 'Ann', bio: '' }
  let drafts: ProfileFields = { name: 'Ann', bio: '' }
  const updateName = vi.fn(options.updateName ?? (() => okAsync(undefined)))
  const updateBio = vi.fn(options.updateBio ?? (() => okAsync(undefined)))
  const signOut = vi.fn(options.signOut ?? (() => okAsync('signed-out' as const)))
  const actor = createActor(
    createProfileMachine({
      profiles: { updateName, updateBio },
      signOut,
      values: () => ({ id, stored, drafts }),
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return {
    actor,
    updateName,
    updateBio,
    signOut,
    emitted,
    /** The person types into a field. */
    type: (field: Field, value: string) => {
      drafts = { ...drafts, [field]: value }
      actor.send({ type: INPUT[field] })
    },
    /** The stored value changes, by a save here or on another device. */
    store: (field: Field, value: string) => {
      stored = { ...stored, [field]: value }
      actor.send({ type: DATA[field] })
    },
    is: (field: Field) =>
      actor.getSnapshot().matches({ editing: { [field]: 'edited' } }) ? 'edited' : 'following',
    save: () => actor.send({ type: 'user.profile.save-button' }),
    idle: () => waitFor(actor, (state) => state.matches({ editing: { save: 'idle' } })),
  }
}

const NOTICE = { type: 'show', anchor: 'app-shell.notice-message', codes: ['profile-saved'] }

describe('profile machine', () => {
  it('follows the stored name until it is typed into, and again once typed back', () => {
    const { is, type, store } = page()

    expect(is('name')).toBe('following')

    type('name', 'Bea')
    store('name', 'Cid')

    expect(is('name')).toBe('edited')

    type('name', 'Cid ')

    expect(is('name')).toBe('following')
  })

  it('lets a saved name follow the stored name, the trimmed one its save stored', async () => {
    const { is, type, store, save, idle, updateName, emitted } = page()

    type('name', ' Bea ')
    save()
    await idle()

    expect(updateName).toHaveBeenCalledWith({ id, name: ' Bea ' })
    expect(emitted).toContainEqual(NOTICE)
    expect(is('name')).toBe('edited')

    store('name', 'Bea')

    expect(is('name')).toBe('following')

    store('name', 'Cid')

    expect(is('name')).toBe('following')
  })

  it('saves the name, then the bio, each only when it changed', async () => {
    const { type, save, idle, updateName, updateBio, emitted } = page()

    type('bio', 'About me')
    save()
    await idle()

    expect(updateName).not.toHaveBeenCalled()
    expect(updateBio).toHaveBeenCalledWith({ id, bio: 'About me' })

    type('name', 'Bea')
    save()
    await idle()

    expect(updateName).toHaveBeenCalledWith({ id, name: 'Bea' })
    expect(updateBio).toHaveBeenLastCalledWith({ id, bio: 'About me' })

    const { save: saveNothing, idle: idleAgain, emitted: told } = page()

    saveNothing()
    await idleAgain()

    expect(told).toEqual([NOTICE])
    expect(emitted).toContainEqual(NOTICE)
  })

  it('keeps the code of a refused save until a save succeeds, and the draft with it', async () => {
    let refuse = true
    const { actor, is, type, save, idle } = page({
      updateName: () => (refuse ? errAsync({ code: 'profile:NAME_REQUIRED' }) : okAsync(undefined)),
    })

    type('name', ' ')
    save()
    await idle()

    expect(actor.getSnapshot().context.error).toBe('profile:NAME_REQUIRED')
    expect(is('name')).toBe('edited')

    refuse = false
    type('name', 'Bea')
    save()
    await idle()

    expect(actor.getSnapshot().context.error).toBeUndefined()
  })

  it('takes no second click on Save while it saves', async () => {
    const saved = Promise.withResolvers<void>()
    const { actor, type, save, idle, updateName } = page({
      updateName: () => ResultAsync.fromSafePromise(saved.promise),
    })

    type('name', 'Bea')
    save()

    expect(actor.getSnapshot().can({ type: 'user.profile.save-button' })).toBe(false)

    save()
    saved.resolve()
    await idle()

    expect(updateName).toHaveBeenCalledOnce()
    expect(actor.getSnapshot().can({ type: 'user.profile.save-button' })).toBe(true)
  })

  it('asks before signing out with unsent changes, and signs out anyway once told', async () => {
    const outcomes: Array<'signed-out' | 'needs-confirmation'> = [
      'needs-confirmation',
      'signed-out',
    ]
    const { actor, signOut, emitted } = page({
      signOut: () => okAsync(outcomes.shift() ?? 'signed-out'),
    })

    actor.send({ type: 'user.profile.sign-out-button' })

    expect(actor.getSnapshot().can({ type: 'user.profile.sign-out-button' })).toBe(false)

    await waitFor(actor, (state) => state.matches({ editing: { session: 'confirming' } }))

    expect(actor.getSnapshot().can({ type: 'user.profile.sign-out-button' })).toBe(false)

    actor.send({ type: 'user.profile.sign-out-dialog.confirm-button' })
    await waitFor(actor, (state) => state.matches('signed-out'))

    expect(signOut).toHaveBeenLastCalledWith({ forgetUnsent: true })
    expect(emitted).toContainEqual({ type: 'navigate', to: '/sign-in' })
  })

  it('closes the dialog on cancel, and moves to sign-in on a sign-out or its failure', async () => {
    const asks = page({ signOut: () => okAsync('needs-confirmation' as const) })

    asks.actor.send({ type: 'user.profile.sign-out-button' })
    await waitFor(asks.actor, (state) => state.matches({ editing: { session: 'confirming' } }))
    asks.actor.send({ type: 'user.profile.sign-out-dialog.cancel-button' })

    expect(asks.actor.getSnapshot().matches({ editing: { session: 'idle' } })).toBe(true)
    expect(asks.actor.getSnapshot().can({ type: 'user.profile.sign-out-button' })).toBe(true)

    const fails = page({
      signOut: () => errAsync(dataError('data:QUERY_FAILED', 'the database went away')),
    })

    fails.actor.send({ type: 'user.profile.sign-out-button' })
    await waitFor(fails.actor, (state) => state.matches('signed-out'))

    expect(fails.emitted).toContainEqual({ type: 'navigate', to: '/sign-in' })
    expect(fails.signOut).toHaveBeenCalledWith(undefined)
  })
})
