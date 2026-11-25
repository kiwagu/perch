/**
 * The language a declared mail speaks, from what a test knows of its sending: the first source of
 * its `language` the test gave a value for (`platform.yaml`, `mail.language`, one source or a list
 * of them).
 */

/** What a test knows of a mail's sending: the values of the action's parameters, the accounts. */
export interface MailValues {
  readonly params: Readonly<Record<string, string>>
  /**
   * The account the mail is about, the one the action acts on (the signed-in account for an
   * action on its own account, else the one its parameters name): its email for a mail declared
   * `to: account`, its language for one whose language is `account`.
   */
  readonly account?: { readonly email: string; readonly language: string }
  /**
   * The account a mail is sent to when the mail goes to an email its action takes as a parameter
   * (an invitation) and an account has that email: its language for the source `recipient`. A
   * test passes it only then; an email without an account has no language of its own.
   */
  readonly recipient?: { readonly language: string }
  /**
   * The organisation the action runs in: its language for the source `organisation`, its default
   * when its settings name one, else the app's built-in one, which the test passes too.
   */
  readonly organisation?: { readonly language: string }
}

/** The language `source` gives in `values`, undefined when the test gave none for it. */
function languageGiven(source: string, values: MailValues): string | undefined {
  switch (source) {
    case 'account':
      return values.account?.language
    case 'recipient':
      return values.recipient?.language
    case 'organisation':
      return values.organisation?.language
    default:
      return values.params[source]
  }
}

/**
 * The language of a mail whose `language` is `language`: the first source of a list the test gave
 * a value for, or the one source written alone; the recipient written alone, the older form, falls
 * back on the account's. A source reached that the test gave no value for fails the test.
 */
export function languageOf(language: string | readonly string[], values: MailValues): string {
  if (language === 'recipient') {
    const value = values.recipient?.language ?? values.account?.language

    if (value === undefined) {
      throw new Error('the test gave no value for "recipient"')
    }

    return value
  }

  for (const source of typeof language === 'string' ? [language] : language) {
    const value = languageGiven(source, values)

    if (value !== undefined) {
      return value
    }

    if (source !== 'recipient') {
      throw new Error(`the test gave no value for "${source}"`)
    }
  }

  throw new Error('the test gave no value for the last source of the language')
}
