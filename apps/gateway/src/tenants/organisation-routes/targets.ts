import { TENANT_KEY_PATTERN } from '@workspace/kernel'

/** What a path names. */
export type Target =
  | { readonly kind: 'organisations' }
  | { readonly kind: 'members'; readonly key: string }
  | { readonly kind: 'member'; readonly key: string; readonly identity: string }
  | { readonly kind: 'invitations'; readonly key: string }
  | { readonly kind: 'invitation'; readonly key: string; readonly invitation: string }

/**
 * The path each kind of target is served under, an organisation's key, a member's identity and an
 * invitation's id written `:key`, `:identity` and `:invitation`.
 */
const PATH_OF: Readonly<Record<Target['kind'], string>> = {
  organisations: '/organisations',
  members: '/organisations/:key/members',
  member: '/organisations/:key/members/:identity',
  invitations: '/organisations/:key/invitations',
  invitation: '/organisations/:key/invitations/:invitation',
}

/** The paths the organisation routes answer. */
export const ORGANISATION_PATHS: readonly string[] = Object.values(PATH_OF)

/** An organisation's key in a path: the kernel's key rule without its anchors. */
const KEY = TENANT_KEY_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '')

/**
 * The organisation paths: every organisation, an organisation's members and invitations, one of
 * its members or invitations. A key outside the rule makes a path that is not the organisations'
 * own, and so does an empty last segment (`.../members/`).
 */
const PATH = new RegExp(`^/organisations(?:/(${KEY})(?:/(members|invitations)(?:/([^/]+))?)?)?$`)

/** What `pathname` names; an organisation's own path (`/organisations/:key`) is not served. */
export function targetOf(pathname: string): Target | undefined {
  const found = PATH.exec(pathname)

  if (!found) {
    return undefined
  }

  const [, key, resource, id] = found

  if (key === undefined) {
    return { kind: 'organisations' }
  }

  if (resource === undefined) {
    return undefined
  }

  if (resource === 'members') {
    return id === undefined ? { kind: 'members', key } : { kind: 'member', key, identity: id }
  }

  return id === undefined
    ? { kind: 'invitations', key }
    : { kind: 'invitation', key, invitation: id }
}
