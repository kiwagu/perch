/**
 * The mails a platform action sends. A `mail` carries a token: who it goes to, the language it
 * speaks, and the screen its link opens with the search parameter that carries the link's token. It
 * is declared on the action, a scenario names it by its action (`[mail:sign-up]`), and a test holds
 * a mail it reads to it. Every account mail that acts has this shape: a verification (`to` the
 * email of a sign-up or a resend), a password reset (`to` an email parameter, `language:
 * account`), a change of email (`to` the new email's parameter) and a deletion's confirmation (`to:
 * account`). A notice only tells, with no token: who it goes to, its language and, at most, a plain
 * link to a screen (a password changed, an email changed, told to the old address); an action
 * declares its notices by name, and a scenario names one `[notice:<action>.<name>]`.
 */

import { z } from '@workspace/zod'

import { kebabNameSchema, screenNameSchema } from '../../names.schema'

/**
 * The account the action acts on, as the recipient of a mail or a notice or the source of its
 * language: the signed-in account for an action on its own account, else, whoever is signed in,
 * the account its parameters name (the email of a password reset's request, the token of a
 * link). A reserved word, so an action that sends either has no parameter of that name
 * (`check/mails.ts`).
 */
export const ACCOUNT = 'account'

/**
 * The account a mail goes to, as the source of its language: the account whose email the mail's
 * `to` names, and the signed-in account when no account has that email. A mail's language alone,
 * never a notice's, and a reserved word on an action that sends a mail (`check/mails.ts`).
 */
export const RECIPIENT = 'recipient'

const nameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/)

const languageSchema = nameSchema.describe(
  "Where the mail's language comes from: a language parameter of the action, or `account` (the account the action acts on). See the rule `mail-recipients`.",
)

export const platformMailSchema = z
  .strictObject({
    to: nameSchema.describe(
      'The parameter of the action whose value the mail goes to, or `account`: the email of the account the action acts on. See the rule `mail-recipients`.',
    ),
    language: nameSchema.describe(
      "Where the mail's language comes from: a language parameter of the action, `account` (the account acted on) or `recipient` (the account the mail goes to). See the rule `mail-recipients`.",
    ),
    link: z
      .strictObject({
        screen: screenNameSchema.describe('The screen the link opens, at the path of its route.'),
        search: nameSchema.describe(
          "The search parameter of that screen's route the link carries its token in; from version 4 the loader gives every route of the screen that parameter. See the rule `mail-link-search`.",
        ),
      })
      .describe("Where the mail's link leads."),
  })
  .describe('The mail the action sends.')

export type PlatformMail = z.infer<typeof platformMailSchema>

export const platformNoticeSchema = z
  .strictObject({
    name: kebabNameSchema.describe(
      'The name of the notice, unique within the action: `password-changed`; a scenario names it `[notice:<action>.<name>]`.',
    ),
    to: nameSchema.describe(
      "The parameter of the action whose value the notice goes to, or `account`: the account's email as it was before the action. See the rule `mail-recipients`.",
    ),
    language: languageSchema,
    link: z
      .strictObject({
        screen: screenNameSchema.describe(
          'The screen the link opens, at a route that needs no parameter: the link carries no token and no search.',
        ),
      })
      .optional()
      .describe(
        "The plain link of the notice, when it has one: a password changed links to the reset of a password, if it was not the account's owner.",
      ),
  })
  .describe('A notice the action sends: a mail that only tells, with no token.')

export type PlatformNotice = z.infer<typeof platformNoticeSchema>
