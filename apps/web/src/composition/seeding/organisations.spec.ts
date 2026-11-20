import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { invitationIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { InvitationView } from '../../platform/organisations.port'

import { ensureInvited, ensureJoined } from './organisations'
import type { SeedError, SeedOrganisationDevice } from './types'

const beto = 'beto@example.test'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme Corp' },
  role: 'member',
}

/** What the admin's invite answers for an email: its invitation, the link of its mail included. */
const invitationTo = (email: string): InvitationView => ({
  id: invitationIdFactory.create(),
  email,
  role: 'member',
  link: `https://perch.example.test/invitation?token=${email}`,
})

describe('ensureInvited', () => {
  it('invites the email as a member and answers the id of the invitation', async () => {
    const asked: Array<readonly unknown[]> = []
    const invitation = invitationTo(beto)
    const device: Pick<SeedOrganisationDevice, 'organisations'> = {
      organisations: {
        create: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        invite: (...input) => {
          asked.push(input)

          return okAsync(invitation)
        },
      },
    }

    expect((await ensureInvited(device, 'acme', beto))._unsafeUnwrap()).toEqual({
      kind: 'invited',
      invitation: invitation.id,
    })
    expect(asked).toEqual([['acme', beto, 'member']])
  })

  it('finds an account that is a member already: there is no invitation to accept', async () => {
    const device: Pick<SeedOrganisationDevice, 'organisations'> = {
      organisations: {
        create: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        invite: () => errAsync(dataError('data:WRITE_REJECTED', 'already-member')),
      },
    }

    expect((await ensureInvited(device, 'acme', beto))._unsafeUnwrap()).toEqual({
      kind: 'already-member',
    })
  })

  it.each([
    ['a refusal of another kind', dataError('data:WRITE_REJECTED', 'not-admin')],
    ['a failure of the network', dataError('data:OFFLINE', 'could not reach the gateway')],
  ])('fails %s', async (_, failure) => {
    const device: Pick<SeedOrganisationDevice, 'organisations'> = {
      organisations: {
        create: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        invite: () => errAsync(failure),
      },
    }

    expect((await ensureInvited(device, 'acme', beto))._unsafeUnwrapErr()).toBe(failure)
  })
})

describe('ensureJoined', () => {
  /** A device whose accept and settle are recorded in the order they happen. */
  function joining(accept: () => ResultAsync<Membership, DataError>) {
    const steps: string[] = []
    const device: Pick<SeedOrganisationDevice, 'invitations' | 'settle'> = {
      invitations: {
        accept: (invitation) => {
          steps.push(`accept ${invitation}`)

          return accept()
        },
      },
      settle: () => {
        steps.push('settle')

        return okAsync<void, SeedError>(undefined)
      },
    }

    return { device, steps }
  }

  it('accepts the invitation by its id, then waits for the gateway to acknowledge', async () => {
    const id = invitationIdFactory.create()
    const { device, steps } = joining(() => okAsync(acme))

    expect((await ensureJoined(device, id))._unsafeUnwrap()).toEqual(acme)
    expect(steps).toEqual([`accept ${id}`, 'settle'])
  })

  it('fails with the refusal of the accept and waits for nothing', async () => {
    const refusal = dataError('data:WRITE_REJECTED', 'invitation-gone')
    const { device, steps } = joining(() => errAsync(refusal))

    expect((await ensureJoined(device, invitationIdFactory.create()))._unsafeUnwrapErr()).toBe(
      refusal,
    )
    expect(steps).toHaveLength(1)
  })
})
