/**
 * The mail a platform action sends: who it goes to, the language it speaks, and the screen its
 * link opens with the search parameter that carries the link's token. It is declared on the action,
 * a scenario names it by its action (`[mail:sign-up]`), and a test holds a mail it reads to it.
 * Every account mail has this shape: a verification (`to` the email of a sign-up or a resend), a
 * password reset (`to` an email parameter, `language: account`), a change of email (`to` the new
 * email's parameter) and a deletion's confirmation (`to: account`).
 */

import { z } from '@workspace/zod'

import { screenNameSchema } from '../../names.schema'

/**
 * The signed-in account, as a mail's recipient or the source of its language: a reserved word, so
 * an action that sends a mail has no parameter of that name (`check/mails.ts`).
 */
export const ACCOUNT = 'account'

const nameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/)

export const platformMailSchema = z
  .strictObject({
    to: nameSchema.describe(
      "The parameter of the action whose value the mail goes to, or `account`: the signed-in account's own email.",
    ),
    language: nameSchema.describe(
      "Where the mail's language comes from: a parameter of the action that holds one of the app's languages, or `account`: the account's settings once it has them, else the language it signed up in.",
    ),
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
