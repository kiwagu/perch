import { resetValidationMode, setValidationMode } from 'entity-id'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type AccountId,
  accountIdFactory,
  type IdentityId,
  type InvitationId,
  identityIdFactory,
  idSchemas,
  invitationIdFactory,
  type MembershipId,
  membershipIdFactory,
  type NoteId,
  noteIdFactory,
  type ProfileId,
  profileIdFactory,
  registry,
  type TenantId,
  tenantIdFactory,
  type VerificationId,
  verificationIdFactory,
} from './index'

afterEach(() => resetValidationMode())

describe('the entity id registry', () => {
  it('mints prefixed ids per kind', () => {
    const id: ProfileId = profileIdFactory.create()

    expect(id.startsWith('prf_')).toBe(true)
    expect(identityIdFactory.create().startsWith('idn_')).toBe(true)
  })

  it('mints the ids of organisations, their memberships and their notes', () => {
    const tenant: TenantId = tenantIdFactory.create()
    const membership: MembershipId = membershipIdFactory.create()
    const note: NoteId = noteIdFactory.create()

    expect(tenant.startsWith('tnt_')).toBe(true)
    expect(membership.startsWith('mbr_')).toBe(true)
    expect(note.startsWith('nte_')).toBe(true)
    expect(registry.kindOf(note)).toBe('note')
  })

  it('mints the ids of the accounts and verifications of the sign-in library', () => {
    const account: AccountId = accountIdFactory.create()
    const verification: VerificationId = verificationIdFactory.create()

    expect(registry.prefixes.account).toBe('acc')
    expect(registry.prefixes.verification).toBe('vrf')
    expect(account).toMatch(/^acc_[0-9a-z]{16}\.[0-9a-z]{10}$/)
    expect(verification).toMatch(/^vrf_[0-9a-z]{16}\.[0-9a-z]{10}$/)
    expect(registry.kindOf(account)).toBe('account')
  })

  it('mints the ids of the invitations to an organisation', () => {
    const invitation: InvitationId = invitationIdFactory.create()

    expect(registry.prefixes.invitation).toBe('inv')
    expect(invitation).toMatch(/^inv_[0-9a-z]{16}\.[0-9a-z]{10}$/)
    expect(registry.kindOf(invitation)).toBe('invitation')
    expect(identityIdFactory.is(invitation)).toBe(false)
  })

  it('tells kinds apart', () => {
    const identity: IdentityId = identityIdFactory.create()

    expect(profileIdFactory.is(identity)).toBe(false)
    expect(registry.kindOf(profileIdFactory.create())).toBe('profile')
    expect(registry.kindOf(identity)).toBe('identity')
  })

  it('does not take an id of the retired user prefix for an identity', () => {
    expect(identityIdFactory.is('usr_0000000000000000.01m52pexcp')).toBe(false)
  })

  it('validates ids at full depth once the full mode is set', () => {
    setValidationMode('full')

    expect(idSchemas.profile.schema.safeParse(profileIdFactory.create()).success).toBe(true)
    expect(idSchemas.profile.schema.safeParse('prf_not-an-id').success).toBe(false)
    expect(idSchemas.profile.schema.safeParse(identityIdFactory.create()).success).toBe(false)
  })
})
