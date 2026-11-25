import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { openStand, type Stand } from './__fixtures__/stand'

/**
 * The gateway as it is served: the routes its server mounts reach the services its composition root
 * builds, here the language an account an invitation creates starts in.
 */

let stand: Stand

beforeAll(async () => {
  stand = await openStand()
})

afterAll(async () => {
  await stand.close()
})

describe('the served gateway', () => {
  it("starts an account an organisation invited in the organisation's default language", async () => {
    const admin = await stand.account()
    const key = await stand.organisation(admin)

    await stand.defaultLanguage(key, 'es')
    await stand.invite(admin, key, 'newcomer@example.test')

    expect(await stand.signUp('newcomer@example.test', 'en')).toBe(202)
    expect(await stand.localeOf('newcomer@example.test')).toBe('es')
  })

  it('starts an account no organisation invited in the language it signed up in', async () => {
    expect(await stand.signUp('stranger@example.test', 'es')).toBe(202)
    expect(await stand.localeOf('stranger@example.test')).toBe('es')
  })
})
