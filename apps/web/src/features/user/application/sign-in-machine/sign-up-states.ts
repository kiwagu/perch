import { clearError, showError } from './effects'

/** What the states of the mode sign-up render: the rules of a new password, the password typed again and the name. */
const RENDERS = {
  renders: [
    'user.sign-in.password-rule-list',
    'user.sign-in.password-confirmation-input',
    'user.sign-in.name-input',
  ],
} as const

/**
 * The states of the mode sign-up while it is being filled in: the password held to the rules of a
 * new password and compared with the password typed again, as either is typed and on the switch
 * into sign-up; the submit is taken only while the password keeps every rule and the two agree.
 */
export const SIGN_UP_STATES = {
  'sign-up': {
    meta: RENDERS,
    on: {
      'user.sign-in.toggle-button': { target: 'sign-in', actions: [clearError] },
      'user.sign-in.password-confirmation-input': {
        target: 'passwords-differ',
        guard: 'confirmationStrays',
      },
      'user.sign-in.password-input': [
        { target: 'password-weak', guard: 'passwordBreaksRules' },
        { target: 'passwords-differ', guard: 'confirmationStrays' },
      ],
      'user.sign-in.submit-button': [
        { target: 'passwords-differ', guard: 'passwordsDiffer' },
        { target: 'signing-up' },
      ],
    },
  },
  // The list marks the rules the password keeps; the password typed again waits to be judged, and
  // the submit is not taken.
  'password-weak': {
    meta: RENDERS,
    on: {
      'user.sign-in.password-input': [
        { guard: 'passwordBreaksRules' },
        { target: 'passwords-differ', guard: 'confirmationStrays' },
        { target: 'sign-up' },
      ],
      'user.sign-in.toggle-button': { target: 'sign-in', actions: [clearError] },
    },
  },
  'passwords-differ': {
    meta: RENDERS,
    entry: [showError('passwords-differ')],
    exit: [clearError],
    on: {
      'user.sign-in.password-confirmation-input': {
        target: 'sign-up',
        guard: 'confirmationFollows',
      },
      'user.sign-in.password-input': [
        { target: 'password-weak', guard: 'passwordBreaksRules' },
        { target: 'sign-up', guard: 'confirmationFollows' },
      ],
      'user.sign-in.toggle-button': { target: 'sign-in' },
    },
  },
} as const
