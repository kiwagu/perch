/** How the specs read a written mail: its root language, and a parameter the render left. */

import { defaultTreeAdapter, parse } from 'parse5'

/** The `lang` of an HTML document's root element, as the e2e suite reads a mail's language. */
export function rootLanguage(html: string): string | undefined {
  const root = parse(html).childNodes.find((node) => defaultTreeAdapter.isElementNode(node))

  return root === undefined
    ? undefined
    : defaultTreeAdapter.getAttrList(root).find(({ name }) => name === 'lang')?.value
}

/** A catalog parameter the render left unsubstituted, such as `{name}`. */
export const UNSUBSTITUTED = /\{[a-z]+\}/

/** Languages the mails are not written in: no mail is written in any of them. */
export const UNSUPPORTED_LOCALES = ['fr', 'EN', 'es-AR', '', '@@', 'en_US!!'] as const

/** Links that are not an http or https address, each by a fixed label a test report may print. */
export const NOT_HTTP_LINKS = [
  ['a script', 'javascript:alert(1)'],
  ['a data address', 'data:text/html,<script>alert(1)</script>'],
  ['a mail address', 'mailto:ann@example.test'],
  ['a path without an origin', '/reset-password?token=abc'],
  ['empty', ''],
] as const
