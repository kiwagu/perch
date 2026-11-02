import { afterEach, describe, expect, it } from 'vitest'

import { idSchemas } from '@workspace/ids'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { accountServicesOf, deviceHeaders, openAuth, signUpOn } from '../__fixtures__/auth-instance'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

/** Ann signed up and verified, and a way to ask Better Auth for her reset links. */
async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  const services = accountServicesOf(opened)
  const { user } = await signUpOn(opened.auth, 'ann@example.test', deviceHeaders('laptop'))
  const link = async (): Promise<string> => {
    const seen = opened.outbox.to('ann@example.test').length

    expect((await services.passwords.requestReset('ann@example.test'))._unsafeUnwrap()).toBe(
      'asked',
    )

    return linkToken(await opened.outbox.next('ann@example.test', seen))
  }

  return { ...opened, ...services, identity: idSchemas.identity.schema.parse(user.id), link }
}

describe('ResetLinks', () => {
  it('reads a link by its token: its identity and its expiry, an hour after it was asked', async () => {
    const { resets, link, identity } = await harness()
    const before = Date.now()
    const token = await link()
    const read = (await resets.read(token))._unsafeUnwrap()

    expect(read?.identity).toBe(identity)
    expect(read?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000)
    expect((await resets.read('no-such-token'))._unsafeUnwrap()).toBeUndefined()
  })

  it('keeps the newest link of the account and ends the earlier ones as Better Auth keeps each new one', async () => {
    const { resets, link } = await harness()
    const first = await link()
    const second = await link()

    expect((await resets.read(first))._unsafeUnwrap()).toBeUndefined()
    expect((await resets.read(second))._unsafeUnwrap()).toBeDefined()
  })
})
