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
 * The account, as the recipient of a mail or a notice or the source of its language: a reserved
 * word, so an action that sends either has no parameter of that name (`check/mails.ts`).
 */
export const ACCOUNT = 'account'

const nameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/)

const languageSchema = nameSchema.describe(
  "Where the mail's language comes from: a parameter of the action that holds one of the app's languages, or `account`: the account's settings once it has them, else the language it signed up in.",
)

export const platformMailSchema = z
  .strictObject({
    to: nameSchema.describe(
      "The parameter of the action whose value the mail goes to, or `account`: the signed-in account's own email.",
    ),
    language: languageSchema,
    link: z
      .strictObject({
        screen: screenNameSchema.describe('The screen the link opens, at the path of its route.'),
        search: nameSchema.describe(
          "The search parameter of that screen's route the link carries its token in.",
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
      'The parameter of the action whose value the notice goes to, or `account`: the email of the account the action acts on, as it was before the action changed anything (an email changed is told to the old address).',
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
