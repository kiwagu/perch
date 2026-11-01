/**
 * The rules a new password keeps, the same wherever it is checked: the sign-up form marks each as
 * the password is typed, and the gateway refuses a sign-up whose password breaks one. They hold
 * for a new password only: a sign-in checks none, so a password chosen before them still signs in.
 */

/** The fewest and the most characters a new password has. */
export const PASSWORD_LENGTH = { min: 10, max: 35 } as const

/** The 32 printable ASCII symbols a password may hold, beside Latin letters and digits. */
export const PASSWORD_SYMBOLS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'

/** The rules, in the order a form lists them. */
export const PASSWORD_RULES = [
  'length',
  'characters',
  'digit',
  'uppercase',
  'lowercase',
  'symbol',
] as const

export type PasswordRule = (typeof PASSWORD_RULES)[number]

/** Whether a password keeps each rule. */
export type PasswordRulesKept = Readonly<Record<PasswordRule, boolean>>

const DIGIT = /^[0-9]$/
const UPPERCASE = /^[A-Z]$/
const LOWERCASE = /^[a-z]$/

const isSymbol = (character: string): boolean => PASSWORD_SYMBOLS.includes(character)

/** A Latin letter, a digit or one of the symbols: no space, no control character, no other script. */
const isAllowed = (character: string): boolean =>
  DIGIT.test(character) ||
  UPPERCASE.test(character) ||
  LOWERCASE.test(character) ||
  isSymbol(character)

/**
 * Which rules `password` keeps: 10 to 35 characters (counted as typed, an emoji one); every
 * character a Latin letter, a digit or one of the symbols, once something is typed; and at least
 * one digit, one uppercase letter, one lowercase letter and one symbol. Nothing typed keeps none.
 */
export function checkPasswordRules(password: string): PasswordRulesKept {
  const characters = [...password]

  return {
    length: characters.length >= PASSWORD_LENGTH.min && characters.length <= PASSWORD_LENGTH.max,
    characters: characters.length > 0 && characters.every(isAllowed),
    digit: characters.some((character) => DIGIT.test(character)),
    uppercase: characters.some((character) => UPPERCASE.test(character)),
    lowercase: characters.some((character) => LOWERCASE.test(character)),
    symbol: characters.some(isSymbol),
  }
}

/** Whether `password` keeps every rule of a new password. */
export function keepsPasswordRules(password: string): boolean {
  const kept = checkPasswordRules(password)

  return PASSWORD_RULES.every((rule) => kept[rule])
}
