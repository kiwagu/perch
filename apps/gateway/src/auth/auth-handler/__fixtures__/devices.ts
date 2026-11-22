/**
 * The devices of an account as the specs of the limit of devices order them: each marked seen a
 * minute after the other, so the device seen least recently, the one a confirmed sign-in signs
 * out, is the one a test names.
 */

import { DeviceSessions } from '../../device-sessions'

import type { mountedOnRealAuth, SignedInAccount } from './mount'

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

const MINUTE_MS = 60_000

/**
 * Marks every device of `account` seen a minute after the other, in the order given, all after
 * every sign-in: a device left out was seen last when it signed in, before all of them.
 */
export async function seenInTurn(
  mounted: Mounted,
  account: Pick<SignedInAccount, 'identity'>,
  devices: readonly string[],
): Promise<void> {
  const rows = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })

  await mounted.clock.advance(Date.now() + MINUTE_MS - mounted.clock.now())

  for (const device of devices) {
    await mounted.clock.advance(MINUTE_MS)
    ;(await rows.seen({ identity: account.identity, device }))._unsafeUnwrap()
  }
}
