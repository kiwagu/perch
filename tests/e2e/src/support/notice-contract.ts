import { expect } from '@playwright/test'
import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from 'parse5'

import type { Mail } from '@workspace/mailbox'

import { BASE_URL } from '../../playwright.config'

import {
  contractProblems,
  type MailValues,
  pathsOf,
  platformAction,
  rootLanguage,
  valueNamed,
} from './mail-contract'
import { mailbox } from './mailbox'

/** The origin the stand serves the application from: a notice's link opens it, or none at all. */
const APP_ORIGIN = new URL(BASE_URL).origin

/** What a test knows of a notice's sending: what it knows of a mail's, and what the notice hides. */
export interface NoticeValues extends MailValues {
  /**
   * An email the notice names no part of: neither the email, nor its local part, nor its domain
   * shows in its subject, its text or its HTML once its own recipient's address is taken out of
   * them (an email changed is told to the old address, which may share the new one's domain).
   */
  readonly hides?: string
}

/**
 * The notice `<action>.<name>` declares, as a scenario names it `[notice:<action>.<name>]`: the
 * action is what comes before the last dot, as a notice's name holds none.
 */
function declared(notice: string) {
  const dot = notice.lastIndexOf('.')
  const action = notice.slice(0, Math.max(dot, 0))
  const name = notice.slice(dot + 1)
  const declaration = platformAction(action)?.notices?.find((each) => each.name === name)

  if (dot <= 0 || declaration === undefined) {
    throw new Error(`no platform action declares the notice "${notice}" (${contractProblems()})`)
  }

  return declaration
}

/** What an HTML document carries, as an HTML parser reads it: its links, and every word it holds. */
interface HtmlReading {
  /** The `href` of every element that has one. */
  readonly links: string[]
  /** Its text nodes and attribute values, entities decoded. */
  readonly words: string[]
}

/** Reads `html` as parse5, the parser jsdom uses, builds it. */
function readHtml(html: string): HtmlReading {
  const reading: HtmlReading = { links: [], words: [] }
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if (defaultTreeAdapter.isTextNode(node)) {
      reading.words.push(defaultTreeAdapter.getTextNodeContent(node))
    }

    if (defaultTreeAdapter.isElementNode(node)) {
      for (const { name, value } of defaultTreeAdapter.getAttrList(node)) {
        reading.words.push(value)

        if (name === 'href') {
          reading.links.push(value)
        }
      }
    }

    if ('childNodes' in node) {
      node.childNodes.forEach(visit)
    }
  }

  visit(parse(html))

  return reading
}

/**
 * Whether `link` opens one of `paths` of the application plainly: over http(s), at the stand's own
 * origin, at one of those paths, with no search and no fragment. A link to another origin, or of
 * another scheme (`javascript:`), with the right path does not.
 */
function opensPlainly(link: URL | null, paths: readonly string[]): boolean {
  return (
    link !== null &&
    (link.protocol === 'https:' || link.protocol === 'http:') &&
    link.origin === APP_ORIGIN &&
    paths.includes(link.pathname) &&
    link.search === '' &&
    link.hash === ''
  )
}

/** Every address a mail's text carries, as a mail client would turn it into a link. */
const addressesOf = (text: string): string[] => text.match(/https?:\/\/[^\s<>"]+/g) ?? []

/**
 * Whether `texts`, the recipient's own address taken out of each, name `email`, its local part or
 * its domain, read without regard to case.
 */
function namesAPartOf(texts: readonly string[], email: string, recipient: string): boolean {
  const at = email.lastIndexOf('@')
  const parts = [email, email.slice(0, Math.max(at, 0)), email.slice(at + 1)]
    .map((part) => part.toLowerCase())
    .filter((part) => part !== '')

  return texts
    .map((text) => text.toLowerCase().replaceAll(recipient, ''))
    .some((text) => parts.some((part) => text.includes(part)))
}

/**
 * Holds a mail to the notice `<action>.<name>` its platform action declares (`platform.yaml`,
 * `notices`): its one recipient, the language of its HTML's root element, and its link, which opens
 * the declared screen of the application at the stand's own origin, over http(s), at the path of
 * one of its routes with no search and no fragment, or none when the notice declares none; with `hides`, that it names no part of that email. Each check asserts
 * a comparison's outcome under a fixed message, so a failure prints no address, no link and no
 * HTML of the mail.
 */
export function expectDeclaredNotice(mail: Mail, notice: string, values: NoticeValues): void {
  const declaration = declared(notice)
  const recipient = valueNamed(declaration.to, values, 'email').toLowerCase()
  const language = valueNamed(declaration.language, values, 'language')
  const html = readHtml(mail.html)
  const links = [...html.links, ...addressesOf(mail.text)].map((link) => URL.parse(link))
  const named = `[notice:${notice}]`

  expect(
    mail.to.length === 1 && mail.to[0]?.address === recipient,
    `recipient mismatch: ${named} does not go to its declared recipient alone`,
  ).toBe(true)
  expect(
    rootLanguage(mail.html) === language,
    `language mismatch: the HTML of ${named} does not speak its declared language`,
  ).toBe(true)

  if (declaration.link === undefined) {
    expect(links.length, `a link in a notice that declares none: ${named} carries one`).toBe(0)
  } else {
    const paths = pathsOf(declaration.link.screen)

    expect(links.length > 0, `missing link: ${named} carries none`).toBe(true)
    expect(
      links.every((link) => opensPlainly(link, paths)),
      `wrong link: a link of ${named} does not open its declared screen plainly`,
    ).toBe(true)
  }

  if (values.hides !== undefined) {
    expect(
      namesAPartOf([mail.subject, mail.text, ...html.words], values.hides, recipient),
      `a hidden email shows: ${named} names a part of it`,
    ).toBe(false)
  }
}

/**
 * Waits for the notice `<action>.<name>` to its declared recipient after the first `seen` mails
 * there, holds it to its declaration and answers it.
 */
export async function nextDeclaredNotice(
  notice: string,
  values: NoticeValues,
  seen: number,
): Promise<Mail> {
  const mail = await mailbox.next(valueNamed(declared(notice).to, values, 'email'), seen)

  expectDeclaredNotice(mail, notice, values)

  return mail
}
