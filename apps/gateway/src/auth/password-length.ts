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
