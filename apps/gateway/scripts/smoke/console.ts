/**
 * The console steps of the smoke test: the smoke's first account appointed an operator by the
 * host's command, which bans a second account while its device is connected, lifts the ban, and
 * signs it out everywhere.
 */

import type { Mailbox } from '@workspace/mailbox'
import { CLOSE } from '@workspace/replica/protocol'

import { REASON } from '../../src/sync/sync-connection'
import { setPlatformRole } from '../operator/platform-role'

import { freshPassword } from './fresh-password'
import { call, callAs, postCredentials, type SignedIn, signUp } from './http'
import { reported } from './reported-answer'
import { check, hello, type Opened, refusal, refusedHello, step, unwrap } from './steps'

/**
 * As `operator` (a live session of the smoke's first account, whose email is `operatorEmail`): the
 * account appointed an operator through the host's command on the directory; a fresh account
 * verified on a device whose socket is open, banned (204, the socket closed with 4004 and the ban's
 * reason), that device's hello with its token closed with 4004, a sign-in with the right password
 * refused 403 `account-banned`; the ban lifted (204) and a sign-in working again; then the account
 * signed out everywhere (204, the new session's socket closed with 4001). The banned account stays
 * on the stand, unbanned, for the sweep of `@example.test` accounts; the first account stays an
 * operator.
 */
export async function consoleSteps(
  base: string,
  mailbox: Mailbox,
  opened: Opened,
  operator: SignedIn,
  operatorEmail: string,
): Promise<void> {
  await step("console: the first account appointed an operator by the host's command", async () => {
    if (opened.root === undefined) {
      throw new Error('the gateway is not open')
    }

    const set = unwrap(await setPlatformRole(opened.root.local, operatorEmail, 'operator'))

    check(set === 'set', `the role write answered ${set}`)
  })

  const credentials = {
    email: `smoke-${crypto.randomUUID()}@example.test`,
    password: freshPassword(),
  }
  const signIn = (id: string) =>
    call(
      base,
      'POST',
      '/auth/sign-in/email',
      undefined,
      { email: credentials.email, password: credentials.password },
      id,
    )
  const banned = await step(
    'console: a second account signed up, its device welcomed',
    async () => {
      const signedIn = await signUp(base, mailbox, {
        ...credentials,
        device: { id: 'smoke-banned-device', label: 'Smoke banned' },
      })

      return { signedIn, socket: (await hello(base, opened, signedIn)).device }
    },
  )
  const account = `/console/accounts/${banned.signedIn.identity.id}`

  await step(
    `console: the second account banned: 204, its socket closed with ${CLOSE.banned} for the ban`,
    async () => {
      const answer = await callAs(base, 'POST', `${account}/ban`, operator, { reason: 'smoke' })

      check(answer.status === 204, `answered ${reported(answer)}`)

      const { code, reason } = await banned.socket.closed

      check(code === CLOSE.banned, `closed with ${code}`)
      check(reason === REASON.banned, `closed for "${reason}"`)
    },
  )

  await step(
    `console: the banned device's hello with its token: closed with ${CLOSE.banned}`,
    async () => {
      const { code } = await refusedHello(base, opened, banned.signedIn)

      check(code === CLOSE.banned, `closed with ${code}`)
    },
  )

  await step('console: a sign-in of the banned account: 403 account-banned', async () => {
    const answer = await signIn('smoke-banned-device')

    check(
      answer.status === 403 && refusal.safeParse(answer.body).data?.code === 'account-banned',
      `answered ${reported(answer)}`,
    )
  })

  const again = await step('console: the ban lifted: 204, a sign-in works again', async () => {
    const answer = await callAs(base, 'POST', `${account}/unban`, operator)

    check(answer.status === 204, `answered ${reported(answer)}`)

    return postCredentials(base, '/auth/sign-in/email', {
      ...credentials,
      device: { id: 'smoke-banned-device', label: 'Smoke banned' },
    })
  })

  await step(
    `console: the account signed out everywhere: 204, its socket closed with ${CLOSE.revoked}`,
    async () => {
      const { device } = await hello(base, opened, again)
      const answer = await callAs(base, 'POST', `${account}/sign-out`, operator)

      check(answer.status === 204, `answered ${reported(answer)}`)

      const { code } = await device.closed

      check(code === CLOSE.revoked, `closed with ${code}`)
    },
  )
}
