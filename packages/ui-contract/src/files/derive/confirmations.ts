/**
 * The question before a destructive action, which the frame's confirmation asks: an action of
 * the model is destructive when its verb is `delete`, one of the platform when the first word of
 * its last segment is `delete`, `remove` or `revoke`. Its code is `<object>-<verb>` for the model
 * (the entity standing for the object when the action names none), the platform action's name
 * with `.` as `-` for the platform: its name does not say what it removes. The vocabulary lists
 * the codes by one rule row, keyed `CONFIRM_RULE_ROW`.
 */

const PLATFORM = 'platform.'
const MODEL_VERBS: ReadonlySet<string> = new Set(['delete'])
const PLATFORM_VERBS: ReadonlySet<string> = new Set(['delete', 'remove', 'revoke'])

/** The key of the vocabulary's row that stands for every derived question code. */
export const CONFIRM_RULE_ROW = '<object>-<verb>'

/** `camelCase` as `kebab-case`. */
const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (upper, at: number) => `${at === 0 ? '' : '-'}${upper.toLowerCase()}`)

/** An action of the model as its entity, its verb and its object (empty when it names none). */
function modelParts(action: string): { entity: string; verb: string; object: string } | undefined {
  const dot = action.indexOf('.')
  const [, verb = '', object = ''] = /^([a-z]+)([A-Z].*)?$/.exec(action.slice(dot + 1)) ?? []

  return dot < 1 ? undefined : { entity: action.slice(0, dot), verb, object }
}

/** The verb of a platform action: the first word of its last segment. */
const platformVerb = (name: string): string =>
  name.slice(name.lastIndexOf('.') + 1).split('-')[0] ?? ''

/** Whether `action`, as a binding or an invoke names it, destroys what it acts on. */
export function isDestructive(action: string): boolean {
  if (action.startsWith(PLATFORM)) {
    return PLATFORM_VERBS.has(platformVerb(action.slice(PLATFORM.length)))
  }

  const parts = modelParts(action)

  return parts !== undefined && MODEL_VERBS.has(parts.verb)
}

/** The code of the question before `action`; none when it is not destructive. */
export function questionCodeOf(action: string): string | undefined {
  if (!isDestructive(action)) {
    return undefined
  }

  if (action.startsWith(PLATFORM)) {
    return action.slice(PLATFORM.length).replaceAll('.', '-')
  }

  const parts = modelParts(action)

  return parts === undefined
    ? undefined
    : `${parts.object === '' ? parts.entity : kebab(parts.object)}-${parts.verb}`
}
