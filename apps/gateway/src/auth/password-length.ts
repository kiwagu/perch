import { CONTRACT_VALUES } from '@workspace/kernel'

/**
 * Whether a password typed to sign in or to confirm work on the account has a length an account's
 * password can have: the contract's `password` value, counted in characters as the gateway counts
 * a text (one per code point). Every password was set under the rules of a new one, so a shorter
 * or a longer one, the empty one included, is no account's: it is refused as a wrong one, and
 * counted as one, without being checked.
 */
export function hasPasswordLength(password: string): boolean {
  const length = [...password].length

  return (
    length >= CONTRACT_VALUES.password.minLength && length <= CONTRACT_VALUES.password.maxLength
  )
}

/**
 * A password of an account's length that no account's password is: every one was set under the
 * rules of a new one, which take printable characters only, never a space. A sign-in hands it to
 * Better Auth in place of a password of no account's length, so that one is refused, counted and
 * timed as a wrong one, after every check that answers before the password is (the request's
 * origin, the email's shape).
 */
export const NO_ACCOUNTS_PASSWORD = ' '.repeat(CONTRACT_VALUES.password.minLength)
