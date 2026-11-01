/**
 * The codes a toast says a success with: an action of the model by its name, a platform action by
 * the platform's `toasts` map, and an operation of several actions by the control that starts it.
 */

import type { Expansion } from '../expansion'

const PLATFORM = 'platform.'
const PAST: ReadonlyMap<string, string> = new Map([
  ['create', 'created'],
  ['update', 'updated'],
  ['delete', 'deleted'],
])

/** `camelCase` as `kebab-case`. */
const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (upper, at: number) => `${at === 0 ? '' : '-'}${upper.toLowerCase()}`)

/** The past of a verb as a code writes it: `save` gives `saved`, `add` gives `added`. */
const pastOf = (verb: string): string => (verb.endsWith('e') ? `${verb}d` : `${verb}ed`)

/** The code a toast says the success of `src` with; none for a platform action. */
export function toastCodeOf(src: string): string | undefined {
  if (src.startsWith(PLATFORM) || !src.includes('.')) {
    return undefined
  }

  const action = src.slice(src.indexOf('.') + 1)
  const [, verb = '', object = ''] = /^([a-z]+)([A-Z].*)?$/.exec(action) ?? []
  const past = PAST.get(verb)

  return past === undefined || object === '' ? `${kebab(action)}-done` : `${kebab(object)}-${past}`
}

/** The code the toast of `src`'s success says: the platform's map for a platform action. */
export const codeOf = (src: string, expansion: Expansion): string | undefined =>
  src.startsWith(PLATFORM)
    ? Object.hasOwn(expansion.platformToasts, src.slice(PLATFORM.length))
      ? expansion.platformToasts[src.slice(PLATFORM.length)]
      : undefined
    : toastCodeOf(src)

/**
 * The code of an operation the control `anchor` of `screen` starts: `<object>-<verb>ed`, the
 * verb the control's name without its kind (the past on its first word), the object the part
 * the control sits in, or the screen's last segment when it sits in the screen itself.
 * `user.profile.save-button` gives `profile-saved`.
 */
export function operationCodeOf(anchor: string, screen: string): string {
  const rest = anchor.startsWith(`${screen}.`) ? anchor.slice(screen.length + 1) : anchor
  const parts = rest.split('.')
  const control = parts.at(-1) ?? rest
  const name = control.includes('-') ? control.slice(0, control.lastIndexOf('-')) : control
  const [first = name, ...others] = name.split('-')
  const object = parts.length > 1 ? (parts.at(-2) ?? '') : (screen.split('.').at(-1) ?? screen)

  return [object, pastOf(first), ...others].join('-')
}
