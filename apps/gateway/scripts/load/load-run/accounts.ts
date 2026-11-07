/** The accounts and organisations a load run signs up; they stay on the stand. */

import { z } from '@workspace/zod'

import { callAs, type SignedIn, signUp as smokeSignUp } from '../../smoke'

import { inParallel } from './pacing'
import { fail, type Run } from './state'

/**
 * Signs up `count` new accounts, numbered from `run.accounts`, each verified through its mail in
 * the stand's mailbox, which signs its device in.
 */
export async function signUp(run: Run, count: number): Promise<SignedIn[]> {
  const first = run.accounts
  const signedUp = await inParallel(Array.from({ length: count }), (_, i) =>
    smokeSignUp(run.base, run.mailbox, {
      name: 'Load test',
      email: `load-${run.id}-${first + i}@example.test`,
      password: run.password,
      device: { id: `load-${run.id}-${first + i}`, label: 'Load test device' },
    }),
  )

  run.accounts += count

  return signedUp
}

/** What an invite answers, as far as the load run reads it: the invitation's id. */
const invited = z.object({ invitation: z.object({ id: z.string() }) })

/**
 * Groups the accounts `members` to an organisation: the first of a group creates it and
 * invites the rest, each of whom accepts by the id its invite answered. Answers each account
 * with the region of its organisation.
 */
export async function organise(run: Run, accounts: readonly SignedIn[]): Promise<string[]> {
  const regions: string[] = []

  for (let from = 0; from < accounts.length; from += run.args.members) {
    const group = accounts.slice(from, from + run.args.members)
    const creator = group[0] ?? fail('an empty group')
    const key = `load_${run.id}_${run.organisations++}`
    const created = await callAs(run.base, 'POST', '/organisations', creator, { key, name: key })

    if (created.status !== 201) fail(`organisation ${key}: ${created.status}`)

    const members = group.slice(1)
    // An accepted invite answers no sooner than its floor: the group's invites wait together.
    const invitations = await inParallel(members, async (member) => {
      const answer = await callAs(run.base, 'POST', `/organisations/${key}/invitations`, creator, {
        email: member.identity.email,
        role: 'member',
      })

      if (answer.status !== 201) fail(`inviting into ${key}: ${answer.status}`)

      return invited.parse(answer.body).invitation.id
    })

    await inParallel(members, async (member, i) => {
      const invitation = invitations[i] ?? fail(`no invitation to ${key} for a member`)
      const accepted = await callAs(run.base, 'POST', '/invitations/accept', member, { invitation })

      if (accepted.status !== 200) fail(`accepting into ${key}: ${accepted.status}`)
    })

    regions.push(...group.map(() => `tenant:${key}`))
  }

  return regions
}
