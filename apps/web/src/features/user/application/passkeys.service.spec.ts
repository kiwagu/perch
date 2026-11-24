import { describe, expect, it } from 'vitest'

import { FakePasskeys, laptopKey, securityKey } from '../../../platform/__fixtures__/passkeys'

import { PasskeysService } from './passkeys.service'

describe('PasskeysService', () => {
  it('lists the passkeys the gateway keeps, the earliest first, and the one just added last', async () => {
    const service = new PasskeysService(new FakePasskeys())

    expect((await service.list())._unsafeUnwrap()).toEqual([laptopKey, securityKey])

    expect((await service.add()).isOk()).toBe(true)

    const listed = (await service.list())._unsafeUnwrap()

    expect(listed).toHaveLength(3)
    expect(listed.slice(0, 2)).toEqual([laptopKey, securityKey])
  })

  it('removes the passkey of an id, and a refusal reaches the caller', async () => {
    const passkeys = new FakePasskeys()
    const service = new PasskeysService(passkeys)

    expect((await service.remove(laptopKey.id)).isOk()).toBe(true)
    expect((await service.list())._unsafeUnwrap()).toEqual([securityKey])
    expect((await service.remove(laptopKey.id)).isErr()).toBe(true)
  })
})
