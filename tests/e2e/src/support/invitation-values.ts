/**
 * What a test knows of an invitation's mail, and the values its declaration in `platform.yaml`
 * (`organisations.invite`, `mail`) is held to: the invited email, the inviter, and the languages
 * of the sources the mail's language may come from that the test knows.
 */

import type { MailValues } from './mail-language'

/** What a test knows of an invitation's mail: the invited email and the account that invited. */
export interface InvitationMail {
  readonly email: string
  /** The signed-in administrator who invited: its email and the language it uses. */
  readonly inviter: { readonly email: string; readonly language: string }
  /**
   * The language of the account the invited email belongs to; given only when it has an account.
   */
  readonly recipientLanguage?: string
  /**
   * The language of the organisation that invites: its default language when its settings name
   * one, else English; given where the mail's declaration takes the organisation's language.
   */
  readonly organisationLanguage?: string
}

/** What the invitation mail's declaration is checked against: the email, the inviter, the languages. */
export function invitationValues({
  email,
  inviter,
  recipientLanguage,
  organisationLanguage,
}: InvitationMail): MailValues {
  return {
    params: { email },
    account: { email: inviter.email, language: inviter.language },
    ...(recipientLanguage === undefined ? {} : { recipient: { language: recipientLanguage } }),
    ...(organisationLanguage === undefined
      ? {}
      : { organisation: { language: organisationLanguage } }),
  }
}
