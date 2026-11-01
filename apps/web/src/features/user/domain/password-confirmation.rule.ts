/** The password and the password typed again, as the sign-up form holds them. */
export interface Passwords {
  readonly password: string
  readonly confirmation: string
}

/**
 * How the password typed again stands to the password: the `same`; `following` while it is how
 * the password begins, a part of it or nothing yet; `strayed` once a character differs or it is
 * longer, so typing on cannot make it the same.
 */
export type PasswordConfirmation = 'same' | 'following' | 'strayed'

/** How the password typed again stands to the password, compared character by character. */
export function checkPasswordConfirmation({
  password,
  confirmation,
}: Passwords): PasswordConfirmation {
  if (confirmation === password) {
    return 'same'
  }

  return password.startsWith(confirmation) ? 'following' : 'strayed'
}
