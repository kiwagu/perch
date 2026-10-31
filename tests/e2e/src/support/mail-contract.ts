import { fileURLToPath } from 'node:url'

import { expect, type Page } from '@playwright/test'

import { firstLink, type Mail } from '@workspace/mailbox'
import { formatProblem, loadScreens } from '@workspace/ui-contract'

import { mailbox } from './mailbox'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const { screens, problems } = loadScreens(ROOT)

/** What a test knows of a mail's sending: the values of the action's parameters, the account. */
export interface MailValues {
  readonly params: Readonly<Record<string, string>>
  /**
   * The account the mail is about: its email for a mail declared `to: account` (the signed-in
   * account's), its language for one declared `language: account`.
   */
  readonly account?: { readonly email: string; readonly language: string }
}

/** The mail a platform action declares, as the contract says it. */
function declared(action: string) {
  const mail = screens?.platform.actions[action]?.mail

  if (screens === undefined || mail === undefined) {
    throw new Error(
      `no platform action "${action}" declares a mail (${problems.map(formatProblem).join('; ')})`,
    )
  }

  const screen = screens.screens.find((each) => each.id === mail.link.screen)

  return { mail, paths: screen?.bindings.map(({ path }) => path) ?? [] }
}

/**
 * The value a declaration's `to` or `language` names: a parameter of the action, or the account's
 * own.
 */
function valueNamed(name: string, values: MailValues, ofAccount: 'email' | 'language'): string {
  const value = name === 'account' ? values.account?.[ofAccount] : values.params[name]

  if (value === undefined) {
    throw new Error(`the test gave no value for "${name}"`)
  }

  return value
}

/**
 * Holds a mail to what its platform action declares (`platform.yaml`, `mail`): its one recipient,
 * the path of the screen its link opens with the declared search parameter set, and the language
 * of its HTML.
 */
export function expectDeclaredMail(mail: Mail, action: string, values: MailValues): void {
  const { mail: declaration, paths } = declared(action)
  const link = new URL(firstLink(mail))

  expect(
    mail.to.map(({ address }) => address),
    `the recipient of [mail:${action}]`,
  ).toEqual([valueNamed(declaration.to, values, 'email').toLowerCase()])
  expect(paths, `the screen the link of [mail:${action}] opens`).toContain(link.pathname)
  expect(
    link.searchParams.get(declaration.link.search),
    `the ${declaration.link.search} of its link`,
  ).toBeTruthy()
  expect(mail.html, `the language of [mail:${action}]`).toContain(
    `<html lang="${valueNamed(declaration.language, values, 'language')}">`,
  )
}

/**
 * Waits for the mail of `action` to its declared recipient after its first `seen`, holds it to its
 * declaration, opens its link in `page`, and answers the mail.
 */
export async function openDeclaredMail(
  page: Page,
  action: string,
  values: MailValues,
  seen = 0,
): Promise<Mail> {
  const { mail: declaration } = declared(action)
  const mail = await mailbox.next(valueNamed(declaration.to, values, 'email'), seen)

  expectDeclaredMail(mail, action, values)
  await page.goto(firstLink(mail))

  return mail
}
