/**
 * The leaves that would lose what the user typed and did not save, as the frame guards them:
 * the platform's `unsavedInput` of the contract (the dialog that asks, and how each leave asks),
 * the controls whose action leaves, the anchors bound to an action of `leaving`, and the controls
 * whose flow moves to another screen, each with the fields that move loses, the anchors that carry
 * `leaves`. `leaving-contract.spec.ts` holds all three to the contract.
 */

import type { Platform } from '@workspace/ui-contract'

export type LeavePolicy = NonNullable<Platform['unsavedInput']>

export const LEAVE_POLICY: LeavePolicy = {
  question: 'app-shell.leave-dialog',
  screen: 'question',
  actions: 'question',
  unload: 'browser',
  state: 'never',
  flow: 'never',
  elsewhere: 'cannot',
}

export const LEAVING_CONTROLS: ReadonlySet<string> = new Set([
  'app-shell.locale-select',
  'app-shell.reload-button',
  'app-shell.sign-out-here-button',
  'app-shell.update-button',
  'organisation.invitation.accept-button',
  'organisation.page.current-select',
  'organisation.received.accept-button',
  'user.profile.sign-out-button',
  'user.settings.locale-select',
])

export const isLeavingControl = (control: string): boolean => LEAVING_CONTROLS.has(control)

export const NAVIGATING_CONTROLS: Readonly<Record<string, readonly string[]>> = {
  'console.users.list.open-link': ['console.users.search-input'],
  'user.sign-in.forgot-link': [
    'user.sign-in.name-input',
    'user.sign-in.password-confirmation-input',
    'user.sign-in.password-input',
  ],
}

/** The fields the move of `control`'s flow to another screen loses; none when it moves nowhere. */
export const lossOf = (control: string): readonly string[] | undefined =>
  Object.hasOwn(NAVIGATING_CONTROLS, control) ? NAVIGATING_CONTROLS[control] : undefined

/** Whether `control` leaves what was typed: its action leaves, or its flow moves to another screen. */
export const leavesInput = (control: string): boolean =>
  isLeavingControl(control) || lossOf(control) !== undefined
