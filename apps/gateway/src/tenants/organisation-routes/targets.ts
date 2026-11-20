import { TENANT_KEY_PATTERN } from '@workspace/kernel'

import { matchPath } from '../../route-path'

/** What a path names. */
export type Target =
  | { readonly kind: 'organisations' }
  | { readonly kind: 'members'; readonly key: string }
  | { readonly kind: 'member'; readonly key: string; readonly identity: string }
  | { readonly kind: 'invitations'; readonly key: string }
  | { readonly kind: 'invitation'; readonly key: string; readonly invitation: string }

/**
 * The path each kind of target is served under, an organisation's key, a member's identity and an
 * invitation's id written `:key`, `:identity` and `:invitation`: `targetOf` answers a path only
 * through these. An organisation's own path (`/organisations/:key`) is not one of them.
 */
const PATH_OF = {
  organisations: '/organisations',
  members: '/organisations/:key/members',
  member: '/organisations/:key/members/:identity',
  invitations: '/organisations/:key/invitations',
  invitation: '/organisations/:key/invitations/:invitation',
} as const satisfies Readonly<Record<Target['kind'], string>>

/** The paths the organisation routes answer. */
export const ORGANISATION_PATHS: readonly string[] = Object.values(PATH_OF)

/** A key in a path keeps the kernel's key rule: a path with another is not the organisations'. */
const KEY = { key: TENANT_KEY_PATTERN }

/**
 * What `pathname` names, or `undefined` for a path that is not one of `PATH_OF`'s: a key outside
 * the rule, an empty segment (`.../members/`) and an organisation's own path included.
 */
export function targetOf(pathname: string): Target | undefined {
  if (matchPath(PATH_OF.organisations, pathname)) {
    return { kind: 'organisations' }
  }

  const members = matchPath(PATH_OF.members, pathname, KEY)

  if (members) {
    return { kind: 'members', key: members.key }
  }

  const member = matchPath(PATH_OF.member, pathname, KEY)

  if (member) {
    return { kind: 'member', key: member.key, identity: member.identity }
  }

  const invitations = matchPath(PATH_OF.invitations, pathname, KEY)

  if (invitations) {
    return { kind: 'invitations', key: invitations.key }
  }

  const invitation = matchPath(PATH_OF.invitation, pathname, KEY)

  return invitation
    ? { kind: 'invitation', key: invitation.key, invitation: invitation.invitation }
    : undefined
}
