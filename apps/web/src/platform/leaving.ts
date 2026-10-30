/**
 * The leaves that would lose what the user typed and did not save, as the frame guards them:
 * the platform's `unsavedInput` of the contract (the dialog that asks, and how each leave asks),
 * and the controls whose action leaves, the anchors bound to an action of `leaving`.
 * `leaving-contract.spec.ts` holds both to the contract.
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
  'organisation.page.current-select',
  'user.profile.sign-out-button',
  'user.settings.locale-select',
])

export const isLeavingControl = (control: string): boolean => LEAVING_CONTROLS.has(control)
