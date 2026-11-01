/**
 * The visibility-button: the eye a password input renders beside itself,
 * `<input>.visibility-button`, which shows what the input holds as typed or hides it again.
 * Presentation only: whether the input shows its value is held by the input itself, the one
 * transient state a flow never holds, so the button is never an event of a flow or an activity,
 * is not one of the controls the machine enables, is always enabled, and gives no action a value:
 * it holds no input. Its `data-value` names
 * what a click does, from the values the suffix defines, never rows of "Choice values".
 */

/** The derived suffix of the eye beside a password input. */
export const VISIBILITY_BUTTON = 'visibility-button'

/** The kind of the one anchor that renders a visibility-button. */
export const VISIBILITY_BASE_KIND = 'input'

/** The `data-value` of a visibility-button, each with what it says. */
export const VISIBILITY_VALUES = {
  show: 'the input hides what it holds, and a click shows it as typed',
  hide: 'the input shows what it holds as typed, and a click hides it again',
} as const satisfies Readonly<Record<string, string>>
