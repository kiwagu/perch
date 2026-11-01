import { render } from '@react-email/render'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { ReactElement } from 'react'

import { anchorsOf } from './html'
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

/** The link survived the render: an anchor of the HTML leads to it, and the text spells it out. */
const carriesLink = ({ html, text }: RenderedBody, link: string): boolean =>
  anchorsOf(html).some(({ href }) => href === link) && text.includes(link)

/**
 * The render boundary every mail goes through: `element`, a mail's whole document, as minified
 * HTML and as plain text. Not pretty-printed: the formatter reflows long text, and a mail client
 * such as Gmail clips a message past about 100 KB, a budget indentation would spend. A render
 * whose HTML has no anchor leading to `link` as it was given, or whose text no longer spells it
 * out, is refused (`mail:LINK_LOST`): a template edit that swallows the link must fail here, not
 * mail a dead button. A render that fails answers `mail:RENDER_FAILED`, nothing of its cause,
 * which may carry the mail's values.
 */
export function renderMail(
  element: ReactElement,
  link: string,
): ResultAsync<RenderedBody, MailWriteError> {
  return ResultAsync.fromPromise(
    Promise.all([render(element, { pretty: false }), render(element, { plainText: true })]),
    (): MailWriteError => RENDER_FAILED,
  ).andThen(([html, text]) =>
    carriesLink({ html, text }, link) ? okAsync({ html, text }) : errAsync(LINK_LOST),
  )
}
