import type { CodeStep } from '@workspace/data'

import type { SignInForm } from '../sign-in.service'

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

/** The anchor of the dialog asking the code of the second factor, which the machine does not keep. */
export const CODE_DIALOG = 'user.sign-in.code.dialog'

/** The anchor of the error of the code step, which the machine keeps for the view. */
export const CODE_ERROR = 'user.sign-in.code.error'

/** The anchor of the field the code is typed in, which the machine's host empties. */
export const CODE_INPUT = 'user.sign-in.code.code-input'

/** What the sign-in form keeps beside its state, for the view. */
export interface SignInContext {
  /** The code of the last failure, cleared by the next attempt and by a switch of mode. */
  readonly error: string | undefined
  /** The code of the mail message, shown once a sign-up or a resend went through. */
  readonly mail: typeof CHECK_YOUR_MAIL | undefined
  /** The address the last sign-up or resend that went through mailed, which the message names. */
  readonly sentTo: string | undefined
  /**
   * The code step the password step asked for, its challenge and the email typed there, from the
   * moment a code is asked until that step ends or is given up.
   */
  readonly step: CodeStep | undefined
  /**
   * The form of the sign-in attempt under way, as it was sent: what a confirmed sign-in past the
   * limit of devices signs in again with, whatever the form holds by then. It is held while the
   * attempt can still ask for that confirmation, and forgotten once the attempt ends.
   */
  readonly attempt: SignInForm | undefined
  /** The code of the last refusal the code step answered without ending, which its dialog shows. */
  readonly codeError: string | undefined
  /**
   * The account a passkey sign-in past the limit of devices asked about, which the confirmation
   * of its dialog names, until that dialog is answered.
   */
  readonly consentFor: string | undefined
}
