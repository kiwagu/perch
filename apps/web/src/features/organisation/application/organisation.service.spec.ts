import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'

import { type AuthUser, type DataError, dataError } from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'
import {
  type IdentityId,
  type InvitationId,
  identityIdFactory,
  invitationIdFactory,
  tenantIdFactory,
} from '@workspace/ids'
import { NO_ABILITY } from '@workspace/kernel'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import type {
  InvitationOnLink,
  InvitationsPort,
  ReceivedInvitation,
} from '../../../platform/invitations.port'
import type {
  InvitationView,
  MemberView,
  OrganisationsPort,
} from '../../../platform/organisations.port'

import { OrganisationService, type OrganisationSession } from './organisation.service'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'member',
}

const initech: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'initech', name: 'Initech' },
  role: 'member',
}

const bea: MemberView = {
  identity: { id: identityIdFactory.create(), email: 'bea@example.test' },
  role: 'member',
}

const toBea: InvitationView = {
  id: invitationIdFactory.create(),
  email: 'bea@example.test',
  role: 'member',
  link: 'https://perch.example.test/invitation?token=bea',
}

const toAcme: ReceivedInvitation = {
  id: invitationIdFactory.create(),
  organisation: { name: 'Acme' },
  role: 'member',
}

const onLink: InvitationOnLink = { organisation: { name: 'Acme' }, role: 'admin', forYou: true }

/** The session's memberships in memory: a selected key of no membership changes nothing. */
class FakeSession implements OrganisationSession {
  user: AuthUser | undefined = undefined
  list: readonly Membership[] = []
  selected: string | undefined = undefined
  readonly listeners = new Set<() => void>()

  current(): AuthUser | undefined {
    return this.user
  }

  memberships(): readonly Membership[] {
    return this.list
  }

  subscribeMemberships(listener: () => void): () => void {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  currentTenant(): Membership | undefined {
    return this.list.find(({ tenant }) => tenant.key === this.selected) ?? this.list[0]
  }

  selectTenant(key: string): void {
    if (this.list.some(({ tenant }) => tenant.key === key)) {
      this.selected = key
    }
  }
}

/** The gateway's organisation routes in memory; `refuse` makes the next call fail with a code. */
class FakeOrganisations implements OrganisationsPort {
  readonly calls: Array<readonly unknown[]> = []
  refusal: DataError | undefined = undefined

  constructor(private readonly session: FakeSession) {}

  #answer<T>(value: T): ResultAsync<T, DataError> {
    const refusal = this.refusal

    this.refusal = undefined

    return refusal ? errAsync(refusal) : okAsync(value)
  }

  create(input: { key: string; name: string }): ResultAsync<Membership, DataError> {
    this.calls.push(['create', input])

    const created: Membership = {
      tenant: { id: tenantIdFactory.create(), key: input.key, name: input.name },
      role: 'admin',
    }

    return this.#answer(created).map((membership) => {
      this.session.list = [...this.session.list, membership]

      return membership
    })
  }

  members(key: string): ResultAsync<readonly MemberView[], DataError> {
    this.calls.push(['members', key])

    return this.#answer([bea])
  }

  invite(key: string, email: string, role: TenantRole): ResultAsync<InvitationView, DataError> {
    this.calls.push(['invite', key, email, role])

    return this.#answer(toBea)
  }

  invitations(key: string): ResultAsync<readonly InvitationView[], DataError> {
    this.calls.push(['invitations', key])

    return this.#answer([toBea])
  }

  revokeInvitation(key: string, invitation: InvitationId): ResultAsync<void, DataError> {
    this.calls.push(['revokeInvitation', key, invitation])

    return this.#answer(undefined)
  }

  setRole(key: string, identity: IdentityId, role: TenantRole): ResultAsync<void, DataError> {
    this.calls.push(['setRole', key, identity, role])

    return this.#answer(undefined)
  }

  remove(key: string, identity: IdentityId): ResultAsync<void, DataError> {
    this.calls.push(['remove', key, identity])

    return this.#answer(undefined)
  }
}

/**
 * The gateway's invitation routes in memory; `refuse` makes the next call fail with a code, and
 * `hold` makes the next accept answer only once the test releases it. An accepted invitation is
 * a membership of the session when the accept answers, as the composition adopts it.
 */
class FakeInvitations implements InvitationsPort {
  readonly calls: Array<readonly unknown[]> = []
  refusal: DataError | undefined = undefined
  release: (() => void) | undefined = undefined
  #held: Promise<void> | undefined = undefined

  constructor(private readonly session: FakeSession) {}

  hold(): void {
    this.#held = new Promise<void>((resolve) => {
      this.release = resolve
    })
  }

  #answer<T>(value: T): ResultAsync<T, DataError> {
    const refusal = this.refusal

    this.refusal = undefined

    return refusal ? errAsync(refusal) : okAsync(value)
  }

  read(token: string): ResultAsync<InvitationOnLink, DataError> {
    this.calls.push(['read', token])

    return this.#answer(onLink)
  }

  mine(): ResultAsync<readonly ReceivedInvitation[], DataError> {
    this.calls.push(['mine'])

    return this.#answer([toAcme])
  }

  accept(invitation: string): ResultAsync<Membership, DataError> {
    this.calls.push(['accept', invitation])

    const held = this.#held

    this.#held = undefined

    return this.#answer(initech).andThen((membership) =>
      ResultAsync.fromSafePromise(held ?? Promise.resolve()).map(() => {
        this.session.list = [...this.session.list, membership]

        return membership
      }),
    )
  }

  decline(invitation: string): ResultAsync<void, DataError> {
    this.calls.push(['decline', invitation])

    return this.#answer(undefined)
  }
}

const refused = (code: string) => dataError('data:WRITE_REJECTED', code)

let session: FakeSession
let organisations: FakeOrganisations
let invitations: FakeInvitations
let service: OrganisationService

beforeEach(() => {
  session = new FakeSession()
  organisations = new FakeOrganisations(session)
  invitations = new FakeInvitations(session)
  service = new OrganisationService(session, organisations, invitations, replicaSchema)
})

describe('OrganisationService', () => {
  it('has no memberships, the same empty list every time, and no current organisation', () => {
    expect(service.memberships()).toEqual([])
    expect(service.memberships()).toBe(service.memberships())
    expect(service.current()).toBeUndefined()
  })

  it('tells the memberships and the current organisation of the session, and selects one', () => {
    let heard = 0
    const stop = service.subscribe(() => {
      heard += 1
    })

    session.list = [acme, globex]

    expect(service.memberships()).toBe(session.list)
    expect(service.current()).toBe(acme)

    service.select('globex')

    expect(service.current()).toBe(globex)

    for (const listener of session.listeners) {
      listener()
    }

    stop()

    expect(heard).toBe(1)
    expect(session.listeners.size).toBe(0)
  })

  it('creates an organisation with its key and name trimmed and makes it the current one', async () => {
    session.list = [acme]

    const created = (await service.create({ key: ' initech ', name: '  Initech ' }))._unsafeUnwrap()

    expect(organisations.calls).toEqual([['create', { key: 'initech', name: 'Initech' }]])
    expect(created.tenant.key).toBe('initech')
    expect(service.current()?.tenant.key).toBe('initech')
  })

  it('refuses a bad key or name without calling the gateway', async () => {
    expect((await service.create({ key: 'Acme Corp', name: 'Acme' }))._unsafeUnwrapErr().code).toBe(
      'organisation:KEY_INVALID',
    )
    expect((await service.create({ key: 'acme', name: '  ' }))._unsafeUnwrapErr().code).toBe(
      'organisation:NAME_REQUIRED',
    )
    expect(
      (await service.create({ key: 'acme', name: 'x'.repeat(81) }))._unsafeUnwrapErr().code,
    ).toBe('organisation:NAME_TOO_LONG')
    expect(organisations.calls).toEqual([])
  })

  it("answers a refusal of the gateway with the gateway's code", async () => {
    organisations.refusal = refused('key-taken')

    expect((await service.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrapErr().code).toBe(
      'key-taken',
    )

    organisations.refusal = refused('no-such-tenant')

    expect(
      (await service.invite('acme', 'nobody@example.test', 'member'))._unsafeUnwrapErr().code,
    ).toBe('no-such-tenant')
  })

  it('answers any other failure with its own code', async () => {
    organisations.refusal = dataError('data:OFFLINE', 'could not reach the gateway')

    expect((await service.members('acme'))._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })

  it('lists the members, and invites and removes them with the role, the email trimmed', async () => {
    expect((await service.members('acme'))._unsafeUnwrap()).toEqual([bea])
    expect((await service.invite('acme', ' bea@example.test ', 'admin'))._unsafeUnwrap()).toEqual(
      toBea,
    )
    expect((await service.remove('acme', bea.identity.id)).isOk()).toBe(true)
    expect(organisations.calls).toEqual([
      ['members', 'acme'],
      ['invite', 'acme', 'bea@example.test', 'admin'],
      ['remove', 'acme', bea.identity.id],
    ])
  })

  it('lists the pending invitations, revokes one by its id and changes a role', async () => {
    expect((await service.invitations('acme'))._unsafeUnwrap()).toEqual([toBea])
    expect((await service.revokeInvitation('acme', toBea.id)).isOk()).toBe(true)
    expect((await service.setRole('acme', bea.identity.id, 'admin')).isOk()).toBe(true)
    expect(organisations.calls).toEqual([
      ['invitations', 'acme'],
      ['revokeInvitation', 'acme', toBea.id],
      ['setRole', 'acme', bea.identity.id, 'admin'],
    ])
  })

  it.each([
    ['setRole', 'last-admin'],
    ['setRole', 'not-admin'],
    ['invite', 'email-invalid'],
    ['invite', 'already-member'],
    ['invite', 'rate-limited'],
  ] as const)("answers the gateway's refusal of %s with its code %s", async (call, code) => {
    organisations.refusal = refused(code)

    const outcome =
      call === 'setRole'
        ? await service.setRole('acme', bea.identity.id, 'member')
        : await service.invite('acme', 'bea@example.test', 'member')

    expect(outcome._unsafeUnwrapErr().code).toBe(code)
  })

  it('answers the invitations of the account and the invitation a link carries', async () => {
    expect((await service.received())._unsafeUnwrap()).toEqual([toAcme])
    expect((await service.readInvitation('link-token'))._unsafeUnwrap()).toEqual(onLink)
    expect((await service.decline(toAcme.id)).isOk()).toBe(true)
    expect(invitations.calls).toEqual([['mine'], ['read', 'link-token'], ['decline', toAcme.id]])
  })

  it('accepts an invitation, adopts its membership and selects that organisation once the adoption settled', async () => {
    session.list = [acme, globex]
    session.selected = 'globex'
    invitations.hold()

    const accepting = service.accept(toAcme.id)

    // The accept has not answered: the organisation is not a membership yet, and nothing is selected.
    await Promise.resolve()
    expect(service.current()).toBe(globex)
    expect(session.list).toEqual([acme, globex])

    invitations.release?.()

    expect((await accepting)._unsafeUnwrap()).toEqual(initech)
    expect(invitations.calls).toEqual([['accept', toAcme.id]])
    expect(session.list).toEqual([acme, globex, initech])
    expect(service.current()).toBe(initech)
  })

  it.each([
    ['accept', 'invitation-gone'],
    ['accept', 'other-account'],
    ['accept', 'already-member'],
    ['decline', 'invitation-gone'],
    ['decline', 'other-account'],
    ['readInvitation', 'link-invalid'],
    ['readInvitation', 'link-expired'],
    ['readInvitation', 'rate-limited'],
  ] as const)(
    "answers the gateway's refusal of %s with its code %s, selecting nothing",
    async (call, code) => {
      session.list = [acme, globex]
      session.selected = 'globex'
      invitations.refusal = refused(code)

      const outcome = await service[call](toAcme.id)

      expect(outcome._unsafeUnwrapErr().code).toBe(code)
      expect(service.current()).toBe(globex)
    },
  )

  it('answers any other failure of an invitation with its own code', async () => {
    invitations.refusal = dataError('data:OFFLINE', 'could not reach the gateway')

    expect((await service.received())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })

  it('gives the current member its ability: a member edits only its own notes, an admin any, nobody without an organisation or signed out', () => {
    const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const bob = identityIdFactory.create()

    session.user = ann
    session.list = [globex]

    expect(service.ability().can('update', 'note', { author: ann.id })).toBe(true)
    expect(service.ability().can('update', 'note', { author: bob })).toBe(false)

    session.list = [acme]

    expect(service.ability().can('update', 'note', { author: bob })).toBe(true)

    session.list = []

    expect(service.ability().can('create', 'note')).toBe(false)

    session.user = undefined
    session.list = [acme]

    expect(service.ability()).toBe(NO_ABILITY)
  })
})
