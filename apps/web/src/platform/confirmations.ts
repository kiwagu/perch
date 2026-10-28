/**
 * The controls that ask the frame's confirmation before their destructive action runs, each with
 * the code it asks with: the anchors of the contract that carry `asks`, which the loader derives
 * from the verb of the action they run. `confirmations-contract.spec.ts` holds the table to the
 * contract.
 */

export const CONFIRMATION = 'app-shell.confirmation'

export const ASKING_CONTROLS: Readonly<Record<string, string>> = {
  'device.list.revoke-button': 'devices-revoke',
  'organisation.members.remove-button': 'organisations-remove',
  'organisation.notes.delete-button': 'note-delete',
}

/** The code `control` asks the confirmation with; none when it runs nothing destructive. */
export const questionOf = (control: string): string | undefined =>
  Object.hasOwn(ASKING_CONTROLS, control) ? ASKING_CONTROLS[control] : undefined
