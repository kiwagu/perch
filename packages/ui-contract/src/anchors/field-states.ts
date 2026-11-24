/** The states a field shows about its input: held and not yet saved, or saved. */
export const FIELD_STATES = ['unsaved', 'saved'] as const

export type FieldState = (typeof FIELD_STATES)[number]

/** The field kinds the kit tracks; a checkbox, a radio and a switch save at once and are not. */
export const STATEFUL_FIELD_KINDS: ReadonlySet<string> = new Set(['input', 'textarea', 'select'])
