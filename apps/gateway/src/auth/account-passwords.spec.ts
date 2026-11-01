import { afterEach, describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { accountServicesOf, deviceHeaders, openAuth, signUpOn } from './__fixtures__/auth-instance'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'
const PASSWORD = 'Pass-word-1'
const NEW_PASSWORD = 'New-pass-word-2'

async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  const { passwords } = accountServicesOf(opened)
  const signedIn = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
  const signsIn = async (password: string) => {
    try {
      await opened.auth.api.signInEmail({
        body: { email: ANN, password },
        headers: deviceHeaders('desk'),
      })

      return true
    } catch {
      return false
    }
  }

  return { ...opened, passwords, signsIn, ...signedIn }
}

describe('AccountPasswords', () => {
  it('asks for a reset mail for any email, and refuses one that is not an email', async () => {
    const { passwords } = await harness()

    expect((await passwords.requestReset(ANN))._unsafeUnwrap()).toBe('asked')
    expect((await passwords.requestReset('ghost@example.test'))._unsafeUnwrap()).toBe('asked')
    expect((await passwords.requestReset('not an email'))._unsafeUnwrap()).toBe('refused')
  })

  it('checks the current password of the session', async () => {
    const { passwords, token } = await harness()

    expect((await passwords.matches(token, PASSWORD))._unsafeUnwrap()).toBe(true)
    expect((await passwords.matches(token, 'Wrong-pass-1'))._unsafeUnwrap()).toBe(false)
  })

  it('changes the password with the current one right, and refuses a wrong one', async () => {
    const { passwords, token, signsIn } = await harness()

    expect((await passwords.change(token, 'Wrong-pass-1', NEW_PASSWORD))._unsafeUnwrap()).toBe(
      'wrong-password',
    )
    expect(await signsIn(PASSWORD)).toBe(true)
    expect((await passwords.change(token, PASSWORD, NEW_PASSWORD))._unsafeUnwrap()).toBe('changed')
    expect(await signsIn(PASSWORD)).toBe(false)
    expect(await signsIn(NEW_PASSWORD)).toBe(true)
  })

  it('sets a password the account then signs in with, and fails for an identity without one', async () => {
    const { passwords, user, signsIn } = await harness()

    ;(await passwords.set(identityIdFactory.brand(user.id), NEW_PASSWORD))._unsafeUnwrap()
    expect(await signsIn(NEW_PASSWORD)).toBe(true)
    expect((await passwords.set(identityIdFactory.create(), NEW_PASSWORD)).isErr()).toBe(true)
  })

  it('fails, naming nothing of the password, for a session that is gone', async () => {
    const { passwords } = await harness()
    const failed = await passwords.change('no-such-token', PASSWORD, NEW_PASSWORD)

    expect(failed._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(JSON.stringify(failed._unsafeUnwrapErr())).not.toContain(PASSWORD)
  })
})
