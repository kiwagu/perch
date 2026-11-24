import { afterEach, describe, expect, it } from 'vitest'

import { type OpenedAuth, openAuth } from './__fixtures__/auth-instance'

const opened: OpenedAuth[] = []

afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.close()
  }
})

/** Better Auth's own internal adapter over the instance's database, as its endpoints reach it. */
async function internalAdapterOf() {
  const one = await openAuth()

  opened.push(one)

  return (await one.auth.$context).internalAdapter
}

describe('consuming a verification value through Better Auth', () => {
  it('gives the value of one identifier to exactly one of the callers that consume it at once', async () => {
    const internalAdapter = await internalAdapterOf()

    for (let round = 0; round < 3; round += 1) {
      const identifier = `consume-race-${round}`

      await internalAdapter.createVerificationValue({
        identifier,
        value: 'token',
        expiresAt: new Date(Date.now() + 60_000),
      })

      const consumed = await Promise.all(
        Array.from({ length: 4 }, () => internalAdapter.consumeVerificationValue(identifier)),
      )

      expect(consumed.filter((value) => value !== null)).toHaveLength(1)
      expect(await internalAdapter.findVerificationValue(identifier)).toBeNull()
    }
  })

  it('answers null for a value that is gone', async () => {
    const internalAdapter = await internalAdapterOf()

    expect(await internalAdapter.consumeVerificationValue('never-written')).toBeNull()
  })
})
