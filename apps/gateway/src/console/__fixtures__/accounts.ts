/**
 * Accounts written straight into a directory for the console's specs: an identity as a sign-up and
 * later changes leave it, its profile, its device sessions and its organisations.
 */

import type { LocalDb } from '@workspace/data'
import {
  device_sessionIdFactory,
  type IdentityId,
  identityIdFactory,
  profileIdFactory,
  tenantIdFactory,
} from '@workspace/ids'

import profileRowStatement from '../../auth/__fixtures__/profile-row.surql'

import accountRowStatement from './account-row.surql'
import organisationRowStatement from './organisation-row.surql'
import sessionRowStatement from './session-row.surql'

/** What an account is written with; what is left out is what a fresh sign-up leaves. */
export interface AccountRow {
  readonly email: string
  /** The name it signed up with; `Ann` when left out. */
  readonly name?: string
  /** When it was made; the first of January 2026 when left out. */
  readonly createdAt?: Date
  readonly emailVerified?: boolean
  readonly banned?: boolean
  readonly banReason?: string
  /** Its platform role as the directory keeps it; none when left out. */
  readonly role?: 'user' | 'operator'
}

/** The instant an account is made at unless a test names another. */
export const MADE_AT = new Date(Date.UTC(2026, 0, 1))

/** Writes the account `row` describes and answers its identity. */
export async function writeAccount(local: LocalDb, row: AccountRow): Promise<IdentityId> {
  const key = identityIdFactory.create()

  await local.db.query(accountRowStatement, {
    key,
    email: row.email,
    name: row.name ?? 'Ann',
    created_at: row.createdAt ?? MADE_AT,
    email_verified: row.emailVerified ?? false,
    banned: row.banned ?? false,
    ban_reason: row.banReason,
    role: row.role,
  })

  return key
}

/** Writes the profile of `identity`, named `name`, as replication would store it. */
export async function writeProfile(
  local: LocalDb,
  identity: IdentityId,
  name: string,
): Promise<void> {
  await local.db.query(profileRowStatement, {
    id: profileIdFactory.create(),
    identity,
    name,
    email: 'profile@example.test',
  })
}

/** A session row of an account: when its device was last seen, and how it stands. */
export interface SessionRow {
  readonly lastSeenAt: Date
  /** When it ended, for one that did; live for a day after `lastSeenAt` otherwise. */
  readonly endedAt?: Date
  /** Whether it still waits for its admission. */
  readonly pending?: boolean
}

/** Writes a session row of `identity` on a device of its own. */
export async function writeSession(
  local: LocalDb,
  identity: IdentityId,
  row: SessionRow,
): Promise<void> {
  const key = device_sessionIdFactory.create()

  await local.db.query(sessionRowStatement, {
    key,
    identity,
    session_token: `token-${key}`,
    device: `device-${key}`,
    last_seen_at: row.lastSeenAt,
    expires_at: row.endedAt ?? new Date(row.lastSeenAt.getTime() + 24 * 60 * 60 * 1000),
    ended_at: row.endedAt,
    pending: row.pending ?? false,
  })
}

/** An organisation an account belongs to, with its role there. */
export interface OrganisationRow {
  readonly key: string
  readonly name: string
  readonly role: 'admin' | 'member'
  /** `ready` when left out. */
  readonly status?: 'provisioning' | 'ready'
}

/** Writes an organisation and the membership of `identity` in it. */
export async function writeOrganisation(
  local: LocalDb,
  identity: IdentityId,
  row: OrganisationRow,
): Promise<void> {
  await local.db.query(organisationRowStatement, {
    tenant: tenantIdFactory.create(),
    key: row.key,
    name: row.name,
    status: row.status ?? 'ready',
    identity,
    role: row.role,
  })
}
