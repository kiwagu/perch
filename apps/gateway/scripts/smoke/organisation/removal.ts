/**
 * The smoke's removal of the invited member from an organisation: the member list refused to it,
 * its removal, which closes the region on its device, the list without it, and its sign-out,
 * after which its token is refused at hello.
 */

import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { callAs, type SignedIn } from '../http'
import { reported } from '../reported-answer'
import { check, hello, type Opened, refusal, refusedHello, step } from '../steps'

import type { Member } from './member'

const listedMembers = z.object({
  members: z.array(z.object({ identity: z.object({ id: z.string() }) })),
})

/** Where the removal runs: the organisation and its region, its owner (an admin) and the invited member. */
export interface Removal {
  readonly key: string
  readonly region: string
  readonly owner: SignedIn
  readonly guest: Member
}

/** Removes the invited member: its device is told, the region closes on it, and its sign-out ends its session. */
export async function removalSteps(
  base: string,
  opened: Opened,
  { key, region, owner, guest }: Removal,
): Promise<void> {
  await step('invited device asked for the members: 403 not-admin', async () => {
    const answer = await callAs(base, 'GET', `/organisations/${key}/members`, guest.signedIn)

    check(
      answer.status === 403 && refusal.safeParse(answer.body).data?.code === 'not-admin',
      `answered ${reported(answer)}`,
    )
  })

  await step('the second identity removed: 204', async () => {
    const answer = await callAs(
      base,
      'DELETE',
      `/organisations/${key}/members/${guest.signedIn.identity.id}`,
      owner,
    )

    check(answer.status === 204, `answered ${reported(answer)}`)
  })

  await step(
    `removed device told of no memberships, a pull closes it with ${CLOSE.forbidden}`,
    async () => {
      const told = await guest.device.next('memberships')

      check(told.memberships.length === 0, `told of ${JSON.stringify(told.memberships)}`)
      guest.device.send({
        type: 'pull',
        region,
        vv: new Uint8Array(guest.doc.doc.oplogVersion().encode()),
      })

      const refused = await guest.device.next('error')
      const { code } = await guest.device.closed

      check(refused.code === 'forbidden-region', `refused with ${refused.code}`)
      check(code === CLOSE.forbidden, `closed with ${code}`)
    },
  )

  await step('the members of the organisation no longer list the second identity', async () => {
    const answer = await callAs(base, 'GET', `/organisations/${key}/members`, owner)

    check(answer.status === 200, `answered ${reported(answer)}`)

    const { members } = listedMembers.parse(answer.body)

    check(members.length > 0, 'no members')
    check(
      !members.some((member) => member.identity.id === guest.signedIn.identity.id),
      'the second identity is still a member',
    )
  })

  await step(`second identity signed out: closed with ${CLOSE.signedOut}`, async () => {
    const { device, welcome } = await hello(base, opened, guest.signedIn)

    check(welcome.memberships.length === 0, 'the removed identity still belongs')
    device.send({ type: 'sign-out', scope: 'device' })

    const { code } = await device.closed

    check(code === CLOSE.signedOut, `closed with ${code}`)
  })

  // The sign-out ends the session the invited device signed up with, not only this connection.
  await step(
    `the signed-out identity's token at hello: closed with ${CLOSE.unauthorized}`,
    async () => {
      const { code } = await refusedHello(base, opened, guest.signedIn)

      check(code === CLOSE.unauthorized, `closed with ${code}`)
    },
  )
}
