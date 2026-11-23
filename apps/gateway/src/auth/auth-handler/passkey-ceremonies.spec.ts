import { describe, expect, it } from 'vitest'

import { passwordStep, withSecondFactor } from './__fixtures__/code-step'
import { ANN, mountedOnRealAuth } from './__fixtures__/mount'
import {
  ageVerifications,
  deletionLinkOf,
  guestCeremony,
  passkeysOf,
  resetLinkOf,
  verificationsOf,
} from './__fixtures__/passkey'

/** The client address a request comes from. */
const FROM = '203.0.113.21'

const MINUTE_MS = 60 * 1000

/** How long a test of several password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** The identifiers of the rows of `verification` of `kind`. */
async function identifiersOf(mounted: Mounted, kind: 'registration' | 'authentication' | 'other') {
  return (await verificationsOf(mounted))
    .filter((row) => row.kind === kind)
    .map(({ identifier }) => identifier)
}

describe('the passkey ceremonies a device leaves unfinished', () => {
  it(
    'reclaims, at the next options of either kind, the ceremonies of both kinds that expired, and no row of another kind, an unexpired ceremony or one that expired under a minute ago',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const passkeys = passkeysOf(mounted)

      // A registration and a guest's sign-in started and left (the browser's window closed), and
      // rows of every other kind: a sign-in's two-factor challenge, a reset link, a pending change
      // of the email and a pending deletion of the account.
      await passkeys.started(ann.on('laptop'))
      await guestCeremony(mounted, 'desk')
      await passwordStep(mounted, 'desk', FROM)
      await resetLinkOf(mounted, FROM)
      ;(await mounted.emailChanges.ask(ann.identity, ANN, 'moved@example.test'))._unsafeUnwrap()
      await deletionLinkOf(mounted, ann.on('laptop'), FROM)

      const others = await identifiersOf(mounted, 'other')
      const [registration = ''] = await identifiersOf(mounted, 'registration')
      const [authentication = ''] = await identifiersOf(mounted, 'authentication')

      expect(others.length).toBeGreaterThanOrEqual(4)

      // Every one of them expired two minutes ago, as their five minutes or their hour passed.
      await ageVerifications(mounted, [...others, registration, authentication], 2 * MINUTE_MS)

      // The next registration's options reclaim both ceremonies and keep their own.
      await passkeys.started(ann.on('laptop'))

      const [kept = ''] = await identifiersOf(mounted, 'registration')

      expect(kept).not.toBe(registration)
      expect(await identifiersOf(mounted, 'authentication')).toEqual([])
      // A ceremony that expired under a minute ago is left: Better Auth's clock may be behind.
      await ageVerifications(mounted, [kept], MINUTE_MS / 2)

      const { challenge } = await guestCeremony(mounted, 'desk')

      expect(challenge).not.toBe('')
      expect(await identifiersOf(mounted, 'registration')).toEqual([kept])
      expect(await identifiersOf(mounted, 'authentication')).toHaveLength(1)
      expect(await identifiersOf(mounted, 'other')).toEqual(others)
    },
    ARGON2_RUNS_MS,
  )

  it('reclaims a bounded number of expired ceremonies at each options, so a backlog drains over several', async () => {
    const mounted = await mountedOnRealAuth()

    for (let left = 0; left < 12; left++) {
      await guestCeremony(mounted, 'desk')
    }

    await ageVerifications(mounted, await identifiersOf(mounted, 'authentication'), 2 * MINUTE_MS)

    const expired = new Set(await identifiersOf(mounted, 'authentication'))
    const stillExpired = async () =>
      (await identifiersOf(mounted, 'authentication')).filter((each) => expired.has(each))

    await guestCeremony(mounted, 'desk')
    expect(await stillExpired()).toHaveLength(2)

    await guestCeremony(mounted, 'desk')
    expect(await stillExpired()).toEqual([])
    expect(await identifiersOf(mounted, 'authentication')).toHaveLength(2)
  })
})
