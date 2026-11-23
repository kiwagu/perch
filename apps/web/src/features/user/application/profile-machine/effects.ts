/** The anchor of the form's own error: the machine keeps the code it shows for the view. */
export const PROFILE_ERROR = 'user.profile.error'

/** The toast of a Save, said once where it ends, however many writes it ran. */
export const SAVED = {
  type: 'show',
  params: { anchor: 'app-shell.toast', codes: ['profile-saved'] },
} as const

/** The form's error after a refused write: the codes of that write, the name's or the bio's. */
export const NAME_REFUSED = {
  type: 'show',
  params: { anchor: PROFILE_ERROR, codes: ['name-required', 'name-too-long', 'failed'] },
} as const
export const BIO_REFUSED = {
  type: 'show',
  params: { anchor: PROFILE_ERROR, codes: ['bio-too-long', 'failed'] },
} as const

export const ASKED = {
  type: 'show',
  params: { anchor: 'user.profile.sign-out-dialog', codes: ['unsent-changes'] },
} as const
export const TO_SIGN_IN = { type: 'navigate', params: { to: '/sign-in' } } as const
