import type { LocalDb } from '@workspace/data'
import { SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { type MailPort, verificationMail } from '../mail'

import { accountLocale } from './account-locale'
import type { AuthLog } from './auth-log'

/** The front's screen a verification link opens: it exchanges the link's token. */
export const VERIFY_EMAIL_PATH = '/verify-email'

/** The account a verification mail goes to, as Better Auth hands it over. */
const mailedAccount = z.object({
  id: idSchemas.identity.schema,
  email: z.string(),
  name: z.string(),
  locale: z.enum(SUPPORTED_LOCALES),
})

export interface VerificationMailerOptions {
  readonly mail: MailPort
  /** The directory, where the account's settings name its language once it has settings. */
  readonly directory: LocalDb
  /** The front's origin, with no trailing slash: the base of the link. */
  readonly publicUrl: string
  /** Hears a mail that did not go out, by its code; the request that asked for it was answered already. */
  readonly log: AuthLog
}

/** The link a verification mail carries: the front's /verify-email with the token. */
export const verificationLink = (publicUrl: string, token: string): string =>
  `${publicUrl}${VERIFY_EMAIL_PATH}?${new URLSearchParams({ token }).toString()}`

/** Writes and sends one verification mail; every failure is logged by its code alone. */
async function deliver(
  options: VerificationMailerOptions,
  user: unknown,
  token: string,
): Promise<void> {
  const account = mailedAccount.safeParse(user)

  if (!account.success) {
    options.log.error({ code: 'mail:SEND_FAILED' }, 'a verification mail named no account')

    return
  }

  const { id, email, name, locale } = account.data
  const settings = await accountLocale(options.directory, id)

  // Only settings found missing fall to the language of the sign-up; settings that could not be
  // read send nothing, rather than a mail in a language the account may have changed.
  if (settings.isErr()) {
    options.log.error(
      { code: 'mail:LOCALE_UNREADABLE' },
      'the language of a verification mail could not be read',
    )

    return
  }

  const sent = await verificationMail({
    to: email,
    name,
    link: verificationLink(options.publicUrl, token),
    locale: settings.value ?? locale,
  }).asyncAndThen((message) => options.mail.send(message))

  if (sent.isErr()) {
    options.log.error({ code: sent.error.code }, 'a verification mail did not go out')
  }
}

/**
 * Better Auth's `sendVerificationEmail`: it starts the mail and returns at once, so a sign-up or a
 * resend answers as soon whether a mail goes out or not. The mail speaks the account's language
 * and links to the front's own screen with the token; Better Auth's `url`, the gateway's own
 * verifying GET, is not used. A mail that cannot be written or sent is reported by its code,
 * never with its address or token.
 */
export function verificationMailer(options: VerificationMailerOptions) {
  return (data: { readonly user: unknown; readonly token: string }): Promise<void> => {
    void deliver(options, data.user, data.token).catch(() =>
      options.log.error({ code: 'mail:SEND_FAILED' }, 'a verification mail failed'),
    )

    return Promise.resolve()
  }
}
