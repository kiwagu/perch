import { afterEach, describe, expect, it } from 'vitest'

import { deviceHeaders, openAuth, signUpOn } from './__fixtures__/auth-instance'
import identityRowStatement from './__fixtures__/identity-row.surql'
import { identityByEmail } from './identity-by-email'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function directory() {
  const opened = await openAuth()

  closers.push(opened.close)

  return opened
}

describe('identityByEmail', () => {
  it('reads the key and the email of the identity of an email, in any case', async () => {
    const { auth, local } = await directory()
    const { user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    expect((await identityByEmail(local, 'Ann@EXAMPLE.test'))._unsafeUnwrap()).toEqual({
      id: user.id,
      email: 'ann@example.test',
    })
  })

  it('reads none for an email no identity has', async () => {
    const { local } = await directory()

    expect((await identityByEmail(local, 'nobody@example.test'))._unsafeUnwrap()).toBeUndefined()
  })

  it('fails, naming nothing of the email, for an identity whose key is not an identity id', async () => {
    const { local } = await directory()

    await local.db.query(identityRowStatement, { key: 'not-ours', email: 'ann@example.test' })

    const error = (await identityByEmail(local, 'ann@example.test'))._unsafeUnwrapErr()

    expect(error).toMatchObject({ code: 'data:QUERY_FAILED' })
    expect(error.message).not.toContain('ann@example.test')
  })

  it('fails once the directory is closed, naming nothing of the email', async () => {
    const { local } = await directory()

    await local.close()

    const error = (await identityByEmail(local, 'ann@example.test'))._unsafeUnwrapErr()

    expect(error.code).toBe('data:QUERY_FAILED')
    expect(error.message).not.toContain('ann@example.test')
  })
})
