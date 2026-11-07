import { TENANT_KEY_PATTERN } from '@workspace/kernel'

/** What a path names. */
export type Target =
  | { readonly kind: 'organisations' }
  | { readonly kind: 'members'; readonly key: string }
  | { readonly kind: 'member'; readonly key: string; readonly identity: string }

/** An organisation's key in a path: the kernel's key rule without its anchors. */
const KEY = TENANT_KEY_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '')

/**
 * The organisation paths: every organisation, an organisation's members, one of its members. A
 * key outside the rule makes a path that is not the organisations' own.
 */
const PATH = new RegExp(`^/organisations(?:/(${KEY})(?:/members(?:/([^/]+))?)?)?$`)

/** What `pathname` names; an organisation's own path (`/organisations/:key`) is not served. */
export function targetOf(pathname: string): Target | undefined {
  const found = PATH.exec(pathname)

  if (!found) {
    return undefined
  }

  const [, key, identity] = found

  if (key === undefined) {
    return { kind: 'organisations' }
  }

  if (identity !== undefined) {
    return { kind: 'member', key, identity }
  }

  return pathname === `/organisations/${key}/members` ? { kind: 'members', key } : undefined
}
