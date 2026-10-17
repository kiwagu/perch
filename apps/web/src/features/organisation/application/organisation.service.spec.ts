import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { MemberView, OrganisationsPort } from '../../../platform/organisations.port'

import { OrganisationService, type OrganisationSession } from './organisation.service'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'member',
}

const bea: MemberView = {
  identity: { id: identityIdFactory.create(), email: 'bea@example.test' },
  role: 'member',
}

/** The session's memberships in memory: a selected key of no membership changes nothing. */
class FakeSession implements OrganisationSession {
  list: readonly Membership[] = []
  selected: string | undefined = undefined
  readonly listeners = new Set<() => void>()

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

  invite(key: string, email: string): ResultAsync<MemberView, DataError> {
    this.calls.push(['invite', key, email])

    return this.#answer(bea)
  }

  remove(key: string, identity: IdentityId): ResultAsync<void, DataError> {
    this.calls.push(['remove', key, identity])

    return this.#answer(undefined)
  }
}

const refused = (code: string) => dataError('data:WRITE_REJECTED', code)

let session: FakeSession
let organisations: FakeOrganisations
let service: OrganisationService

beforeEach(() => {
  session = new FakeSession()
  organisations = new FakeOrganisations(session)
  service = new OrganisationService(session, organisations)
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

    organisations.refusal = refused('no-such-identity')

    expect((await service.invite('acme', 'nobody@example.test'))._unsafeUnwrapErr().code).toBe(
      'no-such-identity',
    )
  })

  it('answers any other failure with its own code', async () => {
    organisations.refusal = dataError('data:OFFLINE', 'could not reach the gateway')

    expect((await service.members('acme'))._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })

  it('lists, invites and removes the members of an organisation', async () => {
    expect((await service.members('acme'))._unsafeUnwrap()).toEqual([bea])
    expect((await service.invite('acme', ' bea@example.test '))._unsafeUnwrap()).toEqual(bea)
    expect((await service.remove('acme', bea.identity.id)).isOk()).toBe(true)
    expect(organisations.calls).toEqual([
      ['members', 'acme'],
      ['invite', 'acme', 'bea@example.test'],
      ['remove', 'acme', bea.identity.id],
    ])
  })
})
