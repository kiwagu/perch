/** The anchor of the form's own error: the machine keeps the code it shows for the view. */
export const SIGN_IN_ERROR = 'user.sign-in.error'

/** The anchor of the message asking to open the verification mail: the machine keeps its code. */
export const MAIL_MESSAGE = 'user.sign-in.mail-message'

/** The code the mail message shows. */
export const CHECK_YOUR_MAIL = 'check-your-mail'

/** The code of a failure that carries none. */
export const UNKNOWN_FAILURE = 'sign-in:UNKNOWN'

/** The code the error keeps while the password typed again differs, which the form finds itself. */
export const PASSWORDS_DIFFER = 'sign-in:PASSWORDS_DIFFER'

/** What the sign-in form keeps beside its state, for the view. */
export interface SignInContext {
  /** The code of the last failure, cleared by the next attempt and by a switch of mode. */
  readonly error: string | undefined
  /** The code of the mail message, shown once a sign-up or a resend went through. */
  readonly mail: typeof CHECK_YOUR_MAIL | undefined
  /** The address the last sign-up or resend that went through mailed, which the message names. */
  readonly sentTo: string | undefined
}
