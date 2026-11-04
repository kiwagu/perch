import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import type { ReactElement } from 'react'

import { anchorsOf } from './html'
import { LINK_FOUND, type MailWriteError } from './mail.error'
import { type RenderedBody, renderBody } from './mail.render'

/** An address in the text: a scheme and `//`, as a mail client turns it into a link. */
const ADDRESS = /[a-z][a-z0-9+.-]*:\/\//i

/**
 * The render boundary of a notice that carries no link: `element` as minified HTML and plain text,
 * refused (`mail:LINK_FOUND`) when its HTML holds an anchor or its text an address, so a template
 * edit that adds a link fails here instead of mailing one. A render that fails answers
 * `mail:RENDER_FAILED`, nothing of its cause.
 */
export function renderNotice(element: ReactElement): ResultAsync<RenderedBody, MailWriteError> {
  return renderBody(element).andThen((body) =>
    anchorsOf(body.html).length === 0 && !ADDRESS.test(body.text)
      ? okAsync(body)
      : errAsync(LINK_FOUND),
  )
}
