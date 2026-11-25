import { z } from '@workspace/zod'

import type { AuthInstance } from '../auth-instance'

import { setCookieValue } from './challenge-cookie'

/**
 * The key Better Auth's passkey plugin names its cookie by (its default `webAuthnChallengeCookie`,
 * which the gateway leaves as it is), which carries a passkey ceremony's challenge; Better Auth puts
 * its namespace and, on an https base URL, a secure prefix around it (`createAuthCookie`).
 */
const PASSKEY_COOKIE = 'better-auth-passkey'

/** Better Auth's passkey challenges as the gateway meets them: the cookie that carries one. */
export interface PasskeyChallenges {
  /** The name of Better Auth's passkey cookie, its namespace and any secure prefix included. */
  cookieName(): Promise<string>
}

/** The passkey challenges of `auth`, the cookie's name read from its own `createAuthCookie`. */
export function passkeyChallenges(auth: Pick<AuthInstance, '$context'>): PasskeyChallenges {
  return {
    cookieName: async () => (await auth.$context).createAuthCookie(PASSKEY_COOKIE).name,
  }
}

/**
 * The options of a passkey ceremony as Better Auth's plugin answers them, for the browser to hand
 * to its authenticator: an object naming its challenge, every other field kept as it is.
 */
const ceremonyOptions = z.looseObject({ challenge: z.string().min(1) })

/** The start of a passkey ceremony as the gateway answers it: the options and the challenge. */
export interface Ceremony {
  readonly options: z.infer<typeof ceremonyOptions>
  /**
   * The value of the plugin's cookie, as it stands on the wire, which the device carries back with
   * the authenticator's answer: the challenge Better Auth signed.
   */
  readonly challenge: string
}

/**
 * The start of a passkey ceremony from the answer of one of the plugin's options endpoints: its
 * options, and the value of the cookie named `cookieName` it set (`setCookieValue`), nothing else of
 * the answer; none when the answer names no options or sets no such cookie.
 */
export async function ceremonyOf(
  answer: Response,
  cookieName: string,
): Promise<Ceremony | undefined> {
  const options = ceremonyOptions.safeParse(await answer.json().catch(() => undefined))
  const challenge = setCookieValue(answer, cookieName)

  return options.success && challenge !== undefined
    ? { options: options.data, challenge }
    : undefined
}
