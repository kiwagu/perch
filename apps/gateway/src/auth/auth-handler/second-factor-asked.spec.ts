import { describe, expect, it } from 'vitest'

import { passwordStep, withSecondFactor } from './__fixtures__/code-step'
import { ANN, mountedOnRealAuth } from './__fixtures__/mount'
import {
  ageVerifications,
  deletionLinkOf,
  guestCeremony,
  resetLinkOf,
  verificationsOf,
} from './__fixtures__/passkey'

/** The client address a request comes from. */
const FROM = '203.0.113.31'

const MINUTE_MS = 60 * 1000

/** How long a test of several password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/**
 * The identifiers of the rows of `verification`, those of pending two-factor challenges (each
 * challenge's own and the one counting its codes) apart from every other.
 */
async function rowsOf(mounted: Mounted) {
  const identifiers = (await verificationsOf(mounted)).map(({ identifier }) => identifier)
  const challenges = identifiers.filter((identifier) => identifier.startsWith('2fa-'))

  return {
    challenges: challenges.sort(),
    others: identifiers.filter((identifier) => !challenges.includes(identifier)).sort(),
  }
}

describe('the two-factor challenges a password step leaves unanswered', () => {
  it(
    'reclaims, at the next password step that writes a challenge, the challenges that expired with the rows counting their codes, and no row of another kind, an unexpired challenge or one that expired under a minute ago',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)

      // Two password steps whose codes never came (the device closed), and rows of every other
      // kind: a guest's passkey ceremony, a reset link, a pending change of the email and a
      // pending deletion of the account.
      await passwordStep(mounted, 'desk', FROM)
      await passwordStep(mounted, 'tablet', FROM)
      await guestCeremony(mounted, 'desk')

      const resetToken = await resetLinkOf(mounted, FROM)

      ;(await mounted.emailChanges.ask(ann.identity, ANN, 'moved@example.test'))._unsafeUnwrap()
      await deletionLinkOf(mounted, ann.on('laptop'), FROM)

      const { challenges: abandoned, others } = await rowsOf(mounted)

      expect(abandoned).toHaveLength(4)
      expect(others.length).toBeGreaterThanOrEqual(4)

      // Every one of them expired two minutes ago.
      await ageVerifications(mounted, [...abandoned, ...others], 2 * MINUTE_MS)

      // The next password step ends both challenges with their counts and keeps its own.
      await passwordStep(mounted, 'desk', FROM)

      const { challenges: kept } = await rowsOf(mounted)

      expect(kept).toHaveLength(2)
      expect(kept.filter((identifier) => abandoned.includes(identifier))).toEqual([])

      // A challenge that expired under a minute ago is left: Better Auth's clock may be behind.
      await ageVerifications(mounted, kept, MINUTE_MS / 2)
      await passwordStep(mounted, 'tablet', FROM)

      const after = await rowsOf(mounted)

      expect(after.challenges).toHaveLength(4)
      expect(after.challenges).toEqual(expect.arrayContaining(kept))
      expect(after.others).toEqual(others)

      // The reset link is still there, and still reads as one that expired.
      const link = (await mounted.deps.resets.read(resetToken))._unsafeUnwrap()

      expect(link?.expiresAt.getTime()).toBeLessThan(Date.now())
    },
    ARGON2_RUNS_MS,
  )
})
