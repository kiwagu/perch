import { render } from '@react-email/render'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { ReactElement } from 'react'

import { anchorsOf } from './html'
import { PRIMARY_ACTION } from './mail.action'
import { LINK_LOST, type MailWriteError, RENDER_FAILED } from './mail.error'

/** A mail's body: its HTML and its plain text. */
export interface RenderedBody {
  readonly html: string
  readonly text: string
}

/** A mail as the mail port sends it: its one recipient, its subject, its HTML and plain text. */
export interface RenderedMail extends RenderedBody {
  readonly to: string
  readonly subject: string
}

/**
 * The link survived the render: the one anchor marked as the primary action (the button) leads to
 * it, another anchor (the raw link for a client that strips buttons) leads to it too, and the
 * text spells it out. Each href is compared as a parser decodes it, so a link HTML escapes is
 * compared as it was given.
 */
function carriesLink({ html, text }: RenderedBody, link: string): boolean {
  const anchors = anchorsOf(html)
  const actions = anchors.filter(({ action }) => action === PRIMARY_ACTION)
  const others = anchors.filter(({ action }) => action !== PRIMARY_ACTION)

  return (
    actions.length === 1 &&
    actions[0]?.href === link &&
    others.some(({ href }) => href === link) &&
    text.includes(link)
  )
}

/**
 * The render boundary every mail goes through: `element`, a mail's whole document, as minified
 * HTML and as plain text. Not pretty-printed: the formatter reflows long text, and a mail client
 * such as Gmail clips a message past about 100 KB, a budget indentation would spend. A render
 * whose button (the one anchor marked with `primaryAction`) does not lead to `link` as it was
 * given, whose raw link lost its anchor, or whose text no longer spells the link out, is refused
 * (`mail:LINK_LOST`): a template edit that breaks the button must fail here, not mail a dead
 * button above a working raw link. A render that fails answers `mail:RENDER_FAILED`, nothing of its cause,
 * which may carry the mail's values.
 */
export function renderMail(
  element: ReactElement,
  link: string,
): ResultAsync<RenderedBody, MailWriteError> {
  return renderBody(element).andThen((body) =>
    carriesLink(body, link) ? okAsync(body) : errAsync(LINK_LOST),
  )
}

/**
 * `element`, a mail's whole document, as minified HTML and as plain text, with no check of what it
 * holds; `mail:RENDER_FAILED` and nothing of its cause when the render fails.
 */
export function renderBody(element: ReactElement): ResultAsync<RenderedBody, MailWriteError> {
  return ResultAsync.fromPromise(
    Promise.all([render(element, { pretty: false }), render(element, { plainText: true })]),
    (): MailWriteError => RENDER_FAILED,
  ).map(([html, text]) => ({ html, text }))
}
