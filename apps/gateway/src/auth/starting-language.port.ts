import type { Locale } from '@workspace/i18n'

/**
 * The language an account starts in when its organisation set one: the default of the organisation
 * whose invitation of the email created it, or none. The levels an account's language is chosen
 * by, the later winning: the environment and the deployment's parameters (named here, not built
 * yet), the built-in default (`en`), the language of the sign-up page, the inviting
 * organisation's default, then the member's own settings, which win from the account's first
 * start on.
 */
export interface StartingLanguage {
  /** The default language of the organisation that invited `email`; none when none names one. */
  of(email: string): Promise<Locale | undefined>
}

/**
 * How long a sign-up looks for its starting language before it starts without it. The sign-up's
 * floor keeps it on top of the time it keeps above Better Auth's work, so a lookup that takes all
 * of it changes no answer's time.
 */
export const STARTING_LANGUAGE_BUDGET_MS = 250

/** Names no language: an account starts in its sign-up page's. */
export const noStartingLanguage: StartingLanguage = { of: () => Promise.resolve(undefined) }
