import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { Locale } from '@workspace/i18n'

import { LocaleWrites } from './locale-writes'
import { createShellMachine, type ShellValues } from './shell.machine'

type Stored = ResultAsync<void, unknown>

/** A frame over its machine: what the guards read, the writes, and what the machine emitted. */
function frame(options: { readonly storeLocale?: (locale: Locale) => Stored } = {}) {
  let values: ShellValues = { signedIn: false, stored: undefined, writes: LocaleWrites.none }
  const storeLocale = vi.fn(options.storeLocale ?? (() => okAsync(undefined)))
  const signOutHere = vi.fn(() => okAsync(undefined))
  const actor = createActor(
    createShellMachine({
      values: () => values,
      storeLocale: (locale) => {
        values = { ...values, writes: values.writes.writing(locale) }

        return storeLocale(locale)
      },
      signOutHere,
    }),
  ).start()
  const spoken: Locale[] = []
  const emitted: unknown[] = []

  actor.on('speak', ({ locale }) => spoken.push(locale))
  actor.on('*', (event) => emitted.push(event))

  return {
    actor,
    storeLocale,
    signOutHere,
    spoken,
    emitted,
    signIn: () => {
      values = { ...values, signedIn: true }
    },
    /** The settings arrive or change on this device, here or from another one. */
    store: (stored: string) => {
      values = { ...values, stored }
      actor.send({ type: 'model.settings.locale' })
      values = { ...values, writes: values.writes.arrived(stored) }
    },
    choose: (locale: Locale) => actor.send({ type: 'app-shell.locale-select', locale }),
    canChoose: () => actor.getSnapshot().can({ type: 'app-shell.locale-select', locale: 'en' }),
    is: (state: 'ready' | 'storing-locale' | 'failed') => actor.getSnapshot().matches(state),
  }
}

const NOT_STORED = {
  type: 'show',
  anchor: 'app-shell.notice-message',
  codes: ['locale-not-stored'],
}

const CLEARED = { type: 'clear', anchor: 'app-shell.notice-message' }

const sameAs = (event: unknown, expected: object): boolean =>
  JSON.stringify(event) === JSON.stringify(expected)

describe('shell machine', () => {
  it('opens the frame, or says the data failed or the browser keeps none', () => {
    const opened = frame()

    opened.actor.send({ type: 'platform.opened' })

    expect(opened.is('ready')).toBe(true)

    const failed = frame()

    failed.actor.send({ type: 'platform.open-failed' })

    expect(failed.is('failed')).toBe(true)

    const blocked = frame()

    blocked.actor.send({ type: 'platform.storage-blocked' })

    expect(blocked.actor.getSnapshot().status).toBe('done')
    expect(blocked.canChoose()).toBe(false)
  })

  it('speaks a language chosen while the data opens, or failed to, and stores none', () => {
    const shell = frame()

    shell.choose('es')
    shell.actor.send({ type: 'platform.open-failed' })
    shell.choose('en')

    expect(shell.spoken).toEqual(['es', 'en'])
    expect(shell.storeLocale).not.toHaveBeenCalled()
  })

  it("speaks a guest's choice with nothing to store", () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.choose('es')

    expect(shell.is('ready')).toBe(true)
    expect(shell.spoken).toEqual(['es'])
    expect(shell.storeLocale).not.toHaveBeenCalled()
  })

  it('takes no choice between a sign-in and the arrival of the settings', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()

    expect(shell.canChoose()).toBe(false)

    shell.store('en')

    expect(shell.canChoose()).toBe(true)
  })

  it('speaks a choice at once and stores it, taking no other choice meanwhile', async () => {
    const stored = Promise.withResolvers<void>()
    const shell = frame({ storeLocale: () => ResultAsync.fromSafePromise(stored.promise) })

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.store('en')
    shell.choose('es')

    expect(shell.spoken).toEqual(['en', 'es'])
    expect(shell.is('storing-locale')).toBe(true)
    expect(shell.storeLocale).toHaveBeenCalledWith('es')
    expect(shell.canChoose()).toBe(false)

    stored.resolve()
    await waitFor(shell.actor, (state) => state.matches('ready'))

    expect(shell.canChoose()).toBe(true)
    expect(shell.emitted).not.toContainEqual(NOT_STORED)
  })

  it('keeps speaking a choice the settings could not store, and says so', async () => {
    const shell = frame({ storeLocale: () => errAsync({ code: 'data:WRITE_FAILED' }) })

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.store('en')
    shell.choose('es')
    await waitFor(shell.actor, (state) => state.matches('ready'))

    expect(shell.spoken.at(-1)).toBe('es')
    expect(shell.emitted).toContainEqual(NOT_STORED)
  })

  it('clears the notice when the account signs out, and a store under way runs on', async () => {
    const stored = Promise.withResolvers<void>()
    const shell = frame({ storeLocale: () => ResultAsync.fromSafePromise(stored.promise) })

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.actor.send({ type: 'platform.signed-out' })

    expect(shell.emitted).toEqual([CLEARED])
    expect(shell.is('ready')).toBe(true)

    shell.store('en')
    shell.choose('es')
    shell.actor.send({ type: 'platform.signed-out' })

    expect(shell.emitted.filter((each) => sameAs(each, CLEARED))).toHaveLength(2)
    expect(shell.is('storing-locale')).toBe(true)

    stored.resolve()
    await waitFor(shell.actor, (state) => state.matches('ready'))
  })

  it("speaks a language another device stored, and not this device's own coming back", async () => {
    const stored = Promise.withResolvers<void>()
    const shell = frame({ storeLocale: () => ResultAsync.fromSafePromise(stored.promise) })

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.store('es')

    expect(shell.spoken).toEqual(['es'])

    shell.choose('en')
    // This device's en comes back while its store still runs: it is not spoken again.
    shell.store('en')
    stored.resolve()
    await waitFor(shell.actor, (state) => state.matches('ready'))
    // Another device stores es.
    shell.store('es')

    expect(shell.spoken).toEqual(['es', 'en', 'es'])
  })

  it('signs the saved account out here when its data failed, then moves to sign-in', async () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.open-failed' })
    shell.actor.send({ type: 'app-shell.sign-out-here-button' })

    expect(shell.actor.getSnapshot().can({ type: 'app-shell.sign-out-here-button' })).toBe(false)

    await waitFor(shell.actor, (state) => state.status === 'done')

    expect(shell.signOutHere).toHaveBeenCalledOnce()
    expect(shell.emitted).toContainEqual({ type: 'navigate', to: '/sign-in' })
  })
})
