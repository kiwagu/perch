/**
 * The request of a platform action over the wire: the account that sends it, the path with its
 * parameters, and a valid value for each parameter but the one a probe sets. A parameter named in
 * the path goes there, the others in the query of a `GET` and in the JSON body of any other
 * method.
 */

import type { Account, Asked, Stand } from './stand'

/** Where a platform action is served: its method and path, `:name` for a segment of the path. */
export interface Wire {
  readonly method: string
  readonly path: string
  /** The parameter each segment carries where it is not the one the segment is named after. */
  readonly segments?: Readonly<Record<string, string>>
}

/** A parameter of an action as the contract declares it, as far as its valid values need it. */
export interface Param {
  readonly name: string
  /** The value it refers to by name (`email`, `profile.name`); none for one that names its type. */
  readonly ref: string | undefined
  readonly optional: boolean
  /** The first member of its enum, when it has one. */
  readonly first: string | number | undefined
  readonly type: string | undefined
}

/** Whose request it is, and what it names: another account, an organisation of the sender. */
export interface World {
  readonly sender: Account
  readonly target: Account
  readonly key: string
}

type Sample = string | number | boolean

/** The text a parameter of a value gets where nothing else is asked, by the value's name. */
const FIXED: Readonly<Record<string, string>> = {
  'new-password': 'Pass-word-2',
  'organisation-name': 'Acme',
  token: 'token-0123456789abcdef',
  'invitation-ref': 'invitation-0123456789',
  'profile.name': 'Ann',
}

/** The actions whose email is the sender's own, since the account they ask about must exist. */
const OWN_EMAIL = new Set(['sign-in'])

/** What a request needs of the stand, for the action `roles` may run. */
export async function worldFor(
  stand: Stand,
  wire: Wire,
  roles: readonly string[] | undefined,
): Promise<World> {
  const sender = roles?.includes('operator') ? await stand.operator() : await stand.account()

  return {
    sender,
    target: await stand.account(),
    key: wire.path.includes(':key') ? await stand.organisation(sender) : '',
  }
}

let fresh = 0

/** A valid value of `param` of the action `action`, as `world` names it. */
function validOf(action: string, param: Param, world: World): Sample {
  const text = param.ref === undefined ? undefined : FIXED[param.ref]
  const unique = ++fresh

  if (text !== undefined) {
    return text
  }

  if (param.first !== undefined) {
    return param.first
  }

  switch (param.ref) {
    case 'email':
      return OWN_EMAIL.has(action) ? world.sender.email : `fresh-${unique}@example.test`
    case 'password':
      return world.sender.password
    case 'organisation-key':
      return `key${unique}`
    case 'id':
      return world.target.identity
    case undefined:
      return param.type === 'boolean' ? true : 1
    default:
      throw new Error(
        `no valid value for ${action}'s ${param.name}, a ${param.ref}: name one in FIXED`,
      )
  }
}

/**
 * The request of `action` with a valid value for each of its `params` it needs, `override` the
 * value of the parameter it names (a valid one when it names none), which a request carries even
 * when it may leave it out.
 */
export function requestFor(
  action: string,
  wire: Wire,
  params: readonly Param[],
  world: World,
  override?: { readonly param: string; readonly value: string | undefined },
): Asked {
  const values = new Map<string, Sample>()

  for (const param of params) {
    if (param.name === override?.param) {
      values.set(param.name, override.value ?? validOf(action, param, world))
    } else if (!param.optional) {
      values.set(param.name, validOf(action, param, world))
    }
  }

  const segments = wire.segments ?? {}
  // A segment no parameter names is the key of the organisation the sender administers.
  const path = wire.path.replace(/:([a-z]+)/g, (_, segment: string) => {
    const name = segments[segment] ?? segment
    const value = values.get(name) ?? world.key

    values.delete(name)

    return encodeURIComponent(String(value))
  })

  if (wire.method === 'GET') {
    const query = new URLSearchParams()

    for (const [name, value] of values) {
      query.set(name, String(value))
    }

    return { method: wire.method, path: `${path}?${query}`, as: world.sender }
  }

  return { method: wire.method, path, as: world.sender, body: Object.fromEntries(values) }
}
