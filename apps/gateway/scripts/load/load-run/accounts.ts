/** The accounts and organisations a load run signs up; they stay on the stand. */

import { callAs, postCredentials, type SignedIn } from '../../smoke'

import { inParallel } from './pacing'
import { fail, type Run } from './state'

/** Signs up `count` new accounts, numbered from `run.accounts`. */
export async function signUp(run: Run, count: number): Promise<SignedIn[]> {
  const first = run.accounts
  const signedUp = await inParallel(Array.from({ length: count }), (_, i) =>
    postCredentials(run.base, '/auth/sign-up/email', {
      name: 'Load test',
      email: `load-${run.id}-${first + i}@example.test`,
      password: run.password,
      device: { id: `load-${run.id}-${first + i}`, label: 'Load test device' },
    }),
  )

  run.accounts += count

  return signedUp
}

/**
 * Groups the accounts `members` to an organisation: the first of a group creates it and
 * invites the rest. Answers each account with the region of its organisation.
 */
export async function organise(run: Run, accounts: readonly SignedIn[]): Promise<string[]> {
  const regions: string[] = []

  for (let from = 0; from < accounts.length; from += run.args.members) {
    const group = accounts.slice(from, from + run.args.members)
    const creator = group[0] ?? fail('an empty group')
    const key = `load_${run.id}_${run.organisations++}`
    const created = await callAs(run.base, 'POST', '/organisations', creator, { key, name: key })

    if (created.status !== 201) fail(`organisation ${key}: ${created.status}`)

    for (const member of group.slice(1)) {
      const invited = await callAs(run.base, 'POST', `/organisations/${key}/members`, creator, {
        email: member.identity.email,
      })

      if (invited.status !== 200) fail(`inviting into ${key}: ${invited.status}`)
    }

    regions.push(...group.map(() => `tenant:${key}`))
  }

  return regions
}
