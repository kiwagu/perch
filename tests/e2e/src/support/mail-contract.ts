import { fileURLToPath } from 'node:url'

import { expect, type Page } from '@playwright/test'
import { defaultTreeAdapter, parse } from 'parse5'

import { firstLink, type Mail } from '@workspace/mailbox'
import { formatProblem, loadScreens } from '@workspace/ui-contract'

import { mailbox } from './mailbox'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const { screens, problems } = loadScreens(ROOT)

/** What a test knows of a mail's sending: the values of the action's parameters, the account. */
export interface MailValues {
  readonly params: Readonly<Record<string, string>>
  /**
   * The account the mail is about, the one the action acts on (the signed-in account, or the one
   * a guest's action names by its parameters): its email for a mail declared `to: account`, its
   * language for one declared `language: account`.
   */
  readonly account?: { readonly email: string; readonly language: string }
}

/**
 * The platform action `action` as the contract declares it, or undefined when it declares none or
 * the contract cannot be read; `contractProblems` says why it cannot.
 */
export const platformAction = (action: string) => screens?.platform.actions[action]

/** What keeps the contract from being read, for a failure that found no declaration in it. */
export const contractProblems = (): string => problems.map(formatProblem).join('; ')

/** The paths of the routes of the screen `screen`, none when the contract has no such screen. */
export const pathsOf = (screen: string): string[] =>
  screens?.screens.find((each) => each.id === screen)?.bindings.map(({ path }) => path) ?? []

/** The mail a platform action declares, as the contract says it. */
function declared(action: string) {
  const mail = platformAction(action)?.mail

  if (mail === undefined) {
    throw new Error(`no platform action "${action}" declares a mail (${contractProblems()})`)
  }

  return { mail, paths: pathsOf(mail.link.screen) }
}

/**
 * The value a declaration's `to` or `language` names: a parameter of the action, or the account's
 * own.
 */
export function valueNamed(
  name: string,
  values: MailValues,
  ofAccount: 'email' | 'language',
): string {
  const value = name === 'account' ? values.account?.[ofAccount] : values.params[name]

  if (value === undefined) {
    throw new Error(`the test gave no value for "${name}"`)
  }

  return value
}

/**
 * The `lang` of an HTML document's root element, as an HTML parser builds the document (parse5,
 * the parser jsdom uses): a comment, a quote style or an attribute order changes nothing.
 */
export function rootLanguage(html: string): string | undefined {
  const root = parse(html).childNodes.find((node) => defaultTreeAdapter.isElementNode(node))

  return root === undefined
    ? undefined
    : defaultTreeAdapter.getAttrList(root).find(({ name }) => name === 'lang')?.value
}

/**
 * Holds a mail to what its platform action declares (`platform.yaml`, `mail`): its one recipient,
 * the path of the screen its link opens with the declared search parameter set, and the language
 * of its HTML's root element. Each check asserts a comparison's outcome under a fixed message, so
 * a failure prints no address, no link, no token and no HTML of the mail.
 */
export function expectDeclaredMail(mail: Mail, action: string, values: MailValues): void {
  const { mail: declaration, paths } = declared(action)
  const recipient = valueNamed(declaration.to, values, 'email').toLowerCase()
  const language = valueNamed(declaration.language, values, 'language')
  const link = URL.parse(firstLink(mail))
  const named = `[mail:${action}]`

  expect(
    mail.to.length === 1 && mail.to[0]?.address === recipient,
    `recipient mismatch: ${named} does not go to its declared recipient alone`,
  ).toBe(true)
  expect(
    link !== null && paths.includes(link.pathname),
    `wrong path: the link of ${named} does not open its declared screen`,
  ).toBe(true)
  expect(
    Boolean(link?.searchParams.get(declaration.link.search)),
    `missing declared parameter: the link of ${named} carries no ${declaration.link.search}`,
  ).toBe(true)
  expect(
    rootLanguage(mail.html) === language,
    `language mismatch: the HTML of ${named} does not speak its declared language`,
  ).toBe(true)
}

/**
 * Opens the link of `mail`, the mail of `action`, in `page`. A failure says so in fixed words: the
 * navigation's own error would print the link, and its token with it.
 */
export async function openMailLink(page: Page, mail: Mail, action: string): Promise<void> {
  const link = firstLink(mail)

  try {
    await page.goto(link)
  } catch {
    throw new Error(`the link of [mail:${action}] did not open`)
  }
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
  await openMailLink(page, mail, action)

  return mail
}
