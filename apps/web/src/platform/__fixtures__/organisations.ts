import { err, errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { vi } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { tenantIdFactory } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import type { InvitationsPort } from '../invitations.port'
import type { OrganisationsPort } from '../organisations.port'
import type { SessionPort } from '../session.port'

import { fakeSession } from './session'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

/** A membership of an organisation with `role`. */
export const membership = (key: string, name: string, role: TenantRole): Membership => ({
  tenant: { id: tenantIdFactory.create(), key, name },
  role,
})

/** A failure of something this test does not use. */
export const unavailable = () => errAsync(dataError('data:WRITE_FAILED', 'not in this test'))

/** An answer of the gateway that comes when the test says: done with a value, or refused with a code. */
export function later<T>() {
  let end: (outcome: Result<T, DataError>) => void = () => undefined
  const result = new ResultAsync<T, DataError>(
    new Promise((resolve) => {
      end = resolve
    }),
  )

  return {
    result,
    done: (value: T) => end(ok(value)),
    refuse: (code: string) => end(err(dataError('data:WRITE_REJECTED', code))),
  }
}

/** The organisations port of a gateway with no members and no invitations, with `more` of it changed. */
export function gatewayWith(more: Partial<OrganisationsPort>): OrganisationsPort {
  return {
    create: unavailable,
    members: vi.fn(() => okAsync([])),
    invite: unavailable,
    invitations: vi.fn(() => okAsync([])),
    revokeInvitation: unavailable,
    setRole: vi.fn(() => okAsync(undefined)),
    remove: unavailable,
    ...more,
  }
}

/** The invitations port of an account with none: nothing to read, accept or decline. */
export const noInvitations: InvitationsPort = {
  read: unavailable,
  mine: () => okAsync([]),
  accept: unavailable,
  decline: unavailable,
}

/**
 * A session of `user`, a member of `memberships` (the first is current). `select` makes another
 * organisation current and tells the page, as a membership change heard from the gateway does,
 * without the page choosing it.
 */
export function sessionIn(user: AuthUser, memberships: readonly Membership[]) {
  let currentKey = memberships[0]?.tenant.key
  const heard = new Set<() => void>()
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => user,
    memberships: () => memberships,
    subscribeMemberships: (listener) => {
      heard.add(listener)

      return () => {
        heard.delete(listener)
      }
    },
    currentTenant: () => memberships.find((each) => each.tenant.key === currentKey),
    selectTenant: (key) => {
      currentKey = key

      for (const listener of heard) {
        listener()
      }
    },
  }

  return { session, select: (key: string) => session.selectTenant(key) }
}
