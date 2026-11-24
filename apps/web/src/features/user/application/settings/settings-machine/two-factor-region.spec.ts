import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { waitFor } from 'xstate'

import { dataError } from '@workspace/data'

import { RENEWED, STARTED, screen } from './__fixtures__/screen'

const PASSWORD = 'Secret-ann1'
const CODE = '123456'
const ENABLE = { type: 'user.settings.two-factor.enable-button', password: PASSWORD } as const
const DISABLE = { type: 'user.settings.two-factor.disable-button', password: PASSWORD } as const
const RENEW = { type: 'user.settings.two-factor.renew-codes-button', password: PASSWORD } as const
const CONFIRM = { type: 'user.settings.two-factor.confirm-button', code: CODE } as const
const STOP = { type: 'user.settings.two-factor.stop-button' } as const
const HIDE = { type: 'user.settings.two-factor.hide-codes-button' } as const

type FactorState =
  | 'idle'
  | 'enabling'
  | 'confirming'
  | 'turning-on'
  | 'codes'
  | 'disabling'
  | 'renewing'

const at = (state: FactorState) => ({ viewing: { 'two-factor': state } }) as const
const clear = (anchor: string) => ({ type: 'clear', anchor })
const READ_SECTION = { type: 'read', anchor: 'user.settings.two-factor.section' }
const PASSWORD_CLEARED = clear('user.settings.two-factor.password-input')
const CODE_CLEARED = clear('user.settings.two-factor.code-input')
const toast = (code: string) => ({ type: 'show', anchor: 'app-shell.toast', codes: [code] })

/** The screen with the second factor turned on up to the key step. */
async function atTheKey(options: Parameters<typeof screen>[0] = {}) {
  const settings = screen(options)

  settings.actor.send(ENABLE)
  await waitFor(settings.actor, (state) => state.matches(at('confirming')))
  settings.emitted.length = 0

  return settings
}

describe('the second factor region, turning it on', () => {
  it('asks the key with the password, keeps it with its enrolment and empties the password', async () => {
    const enableTwoFactor = vi.fn((_password: string) => okAsync(STARTED))
    const settings = screen({ enableTwoFactor })

    settings.actor.send(ENABLE)

    expect(settings.actor.getSnapshot().can(ENABLE)).toBe(false)

    const keyed = await waitFor(settings.actor, (state) => state.matches(at('confirming')))

    expect(enableTwoFactor).toHaveBeenCalledWith(PASSWORD)
    expect(keyed.context.start).toEqual(STARTED)
    expect(keyed.context.twoFactorError).toBeUndefined()
    expect(settings.emitted).toEqual([PASSWORD_CLEARED])
    // The key step takes the code and the stop; the second factor is still off, so no read.
    expect(keyed.can(CONFIRM)).toBe(true)
    expect(keyed.can(STOP)).toBe(true)
    expect(keyed.can(ENABLE)).toBe(false)
    expect(keyed.can(DISABLE)).toBe(false)
  })

  it.each(['data:INVALID_CREDENTIALS', 'data:RATE_LIMITED', 'data:OFFLINE'] as const)(
    'says why %s refused the key, keeping the password as typed and nothing held',
    async (code) => {
      const settings = screen({ enableTwoFactor: () => errAsync(dataError(code, 'refused')) })

      settings.actor.send(ENABLE)

      const refused = await waitFor(
        settings.actor,
        (state) => state.context.twoFactorError === code,
      )

      expect(refused.matches(at('idle'))).toBe(true)
      expect(refused.context.start).toBeUndefined()
      expect(settings.emitted).toEqual([])
      expect(refused.can(ENABLE)).toBe(true)
    },
  )

  it('reads the section as it is now when the second factor changed meanwhile, emptying the password', async () => {
    const settings = screen({
      enableTwoFactor: () => errAsync(dataError('data:TWO_FACTOR_CHANGED', 'turned on elsewhere')),
    })

    settings.actor.send(ENABLE)

    const refused = await waitFor(settings.actor, (state) => state.matches(at('idle')))

    expect(refused.context.twoFactorError).toBe('data:TWO_FACTOR_CHANGED')
    expect(settings.emitted).toEqual([PASSWORD_CLEARED, READ_SECTION])
  })

  it('forgets the last refusal as the next request goes out', async () => {
    let refuse = true
    const settings = screen({
      enableTwoFactor: () =>
        refuse ? errAsync(dataError('data:INVALID_CREDENTIALS', 'wrong')) : okAsync(STARTED),
    })

    settings.actor.send(ENABLE)
    await waitFor(settings.actor, (state) => state.context.twoFactorError !== undefined)

    refuse = false
    settings.actor.send(ENABLE)
    expect(settings.actor.getSnapshot().context.twoFactorError).toBeUndefined()
    await waitFor(settings.actor, (state) => state.matches(at('confirming')))
  })

  it('confirms with the code and the enrolment of the key shown, then shows the codes the start answered and reads the section', async () => {
    const confirmTwoFactor = vi.fn((_code: string, _enrolment: string) => okAsync(undefined))
    const settings = await atTheKey({ confirmTwoFactor })

    settings.actor.send(CONFIRM)

    expect(settings.actor.getSnapshot().can(CONFIRM)).toBe(false)

    const on = await waitFor(settings.actor, (state) => state.matches(at('codes')))

    expect(confirmTwoFactor).toHaveBeenCalledWith(CODE, STARTED.enrolment)
    // The codes are the start's, shown once; the key is not held any more.
    expect(on.context.backupCodes).toEqual(STARTED.backupCodes)
    expect(on.context.start).toBeUndefined()
    expect(settings.emitted).toEqual([CODE_CLEARED, READ_SECTION, toast('two-factor-enabled')])
    expect(on.can(HIDE)).toBe(true)
    expect(on.can(CONFIRM)).toBe(false)
  })

  it('says a code the key does not give, keeping the key and the code as typed', async () => {
    const settings = await atTheKey({
      confirmTwoFactor: () => errAsync(dataError('data:INVALID_CODE', 'not that code')),
    })

    settings.actor.send(CONFIRM)

    const refused = await waitFor(
      settings.actor,
      (state) => state.context.twoFactorError !== undefined,
    )

    expect(refused.matches(at('confirming'))).toBe(true)
    expect(refused.context.twoFactorError).toBe('data:INVALID_CODE')
    expect(refused.context.start).toEqual(STARTED)
    expect(refused.context.backupCodes).toBeUndefined()
    expect(settings.emitted).toEqual([])
    expect(refused.can(CONFIRM)).toBe(true)
  })

  it('leaves the key and reads the section when the key was replaced or the factor turned on elsewhere', async () => {
    const settings = await atTheKey({
      confirmTwoFactor: () => errAsync(dataError('data:TWO_FACTOR_CHANGED', 'replaced')),
    })

    settings.actor.send(CONFIRM)

    const left = await waitFor(settings.actor, (state) => state.matches(at('idle')))

    expect(left.context.twoFactorError).toBe('data:TWO_FACTOR_CHANGED')
    expect(left.context.start).toBeUndefined()
    expect(left.context.backupCodes).toBeUndefined()
    expect(settings.emitted).toEqual([CODE_CLEARED, READ_SECTION])
  })

  it('stops turning it on: back to off, the code and its refusal cleared, the key forgotten', async () => {
    const settings = await atTheKey({
      confirmTwoFactor: () => errAsync(dataError('data:INVALID_CODE', 'not that code')),
    })

    settings.actor.send(CONFIRM)
    await waitFor(settings.actor, (state) => state.context.twoFactorError !== undefined)
    settings.emitted.length = 0
    settings.actor.send(STOP)

    const stopped = settings.actor.getSnapshot()

    expect(stopped.matches(at('idle'))).toBe(true)
    expect(stopped.context).toMatchObject({ start: undefined, twoFactorError: undefined })
    expect(settings.emitted).toEqual([CODE_CLEARED])
    expect(stopped.can(CONFIRM)).toBe(false)
    expect(stopped.can(ENABLE)).toBe(true)
  })

  it('asks a new key the next time, whose codes are the new ones', async () => {
    const second = { ...STARTED, backupCodes: RENEWED }
    const answers = [okAsync(STARTED), okAsync(second)]
    const settings = screen({ enableTwoFactor: () => answers.shift() ?? okAsync(STARTED) })

    settings.actor.send(ENABLE)
    await waitFor(settings.actor, (state) => state.matches(at('confirming')))
    settings.actor.send(STOP)
    settings.actor.send(ENABLE)
    await waitFor(settings.actor, (state) => state.context.start === second)
    settings.actor.send(CONFIRM)

    const on = await waitFor(settings.actor, (state) => state.matches(at('codes')))

    expect(on.context.backupCodes).toEqual(RENEWED)
  })
})

describe('the second factor region, the codes', () => {
  it('hides the codes, which nothing shows again', async () => {
    const settings = await atTheKey()

    settings.actor.send(CONFIRM)
    await waitFor(settings.actor, (state) => state.matches(at('codes')))
    settings.actor.send(HIDE)

    const hidden = settings.actor.getSnapshot()

    expect(hidden.matches(at('idle'))).toBe(true)
    expect(hidden.context.backupCodes).toBeUndefined()
    expect(hidden.context.start).toBeUndefined()
  })

  it('renews the codes with the password, shows the ten new ones and empties the password', async () => {
    const renewCodes = vi.fn((_password: string) => okAsync(RENEWED))
    const settings = screen({ renewCodes })

    settings.actor.send(RENEW)

    expect(settings.actor.getSnapshot().can(RENEW)).toBe(false)

    const renewed = await waitFor(settings.actor, (state) => state.matches(at('codes')))

    expect(renewCodes).toHaveBeenCalledWith(PASSWORD)
    expect(renewed.context.backupCodes).toEqual(RENEWED)
    // Nothing about the second factor itself changed: no read, no toast.
    expect(settings.emitted).toEqual([PASSWORD_CLEARED])
  })

  it.each(['data:INVALID_CREDENTIALS', 'data:RATE_LIMITED', 'data:OFFLINE'] as const)(
    'says why %s refused a renewal, keeping the password and showing no codes',
    async (code) => {
      const settings = screen({ renewCodes: () => errAsync(dataError(code, 'refused')) })

      settings.actor.send(RENEW)

      const refused = await waitFor(
        settings.actor,
        (state) => state.context.twoFactorError === code,
      )

      expect(refused.matches(at('idle'))).toBe(true)
      expect(refused.context.backupCodes).toBeUndefined()
      expect(settings.emitted).toEqual([])
    },
  )

  it('reads the section as it is now when it was turned off meanwhile, emptying the password', async () => {
    const settings = screen({
      renewCodes: () => errAsync(dataError('data:TWO_FACTOR_CHANGED', 'turned off elsewhere')),
    })

    settings.actor.send(RENEW)

    const refused = await waitFor(settings.actor, (state) => state.matches(at('idle')))

    expect(refused.context.twoFactorError).toBe('data:TWO_FACTOR_CHANGED')
    expect(settings.emitted).toEqual([PASSWORD_CLEARED, READ_SECTION])
  })
})

describe('the second factor region, turning it off', () => {
  it('turns it off with the password, empties it, reads the section and says so', async () => {
    const disableTwoFactor = vi.fn((_password: string) => okAsync(undefined))
    const settings = screen({ disableTwoFactor })

    settings.actor.send(DISABLE)

    expect(settings.actor.getSnapshot().can(DISABLE)).toBe(false)

    await waitFor(settings.actor, (state) => state.matches(at('idle')))

    expect(disableTwoFactor).toHaveBeenCalledWith(PASSWORD)
    expect(settings.emitted).toEqual([PASSWORD_CLEARED, READ_SECTION, toast('two-factor-disabled')])
  })

  it.each(['data:INVALID_CREDENTIALS', 'data:RATE_LIMITED', 'data:OFFLINE'] as const)(
    'says why %s refused it, keeping the password as typed and reading nothing',
    async (code) => {
      const settings = screen({ disableTwoFactor: () => errAsync(dataError(code, 'refused')) })

      settings.actor.send(DISABLE)

      const refused = await waitFor(
        settings.actor,
        (state) => state.context.twoFactorError === code,
      )

      expect(refused.matches(at('idle'))).toBe(true)
      expect(settings.emitted).toEqual([])
    },
  )

  it('takes no other request while one runs', () => {
    const settings = screen({ disableTwoFactor: () => new ResultAsync(new Promise(() => {})) })

    settings.actor.send(DISABLE)

    const running = settings.actor.getSnapshot()

    expect([ENABLE, DISABLE, RENEW].map((event) => running.can(event))).toEqual([
      false,
      false,
      false,
    ])
  })

  it('leaves the other regions to their own presses', async () => {
    const settings = screen({ enableTwoFactor: () => new ResultAsync(new Promise(() => {})) })

    settings.actor.send(ENABLE)

    const running = settings.actor.getSnapshot()

    expect(running.can({ type: 'user.settings.deletion.send-button', password: PASSWORD })).toBe(
      true,
    )
    expect(running.can({ type: 'user.settings.passkeys.add-button' })).toBe(true)
  })
})
