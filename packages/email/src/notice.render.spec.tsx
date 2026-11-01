import { describe, expect, it } from 'vitest'

import { renderNotice } from './notice.render'

/** A recognisable value: no error may carry it. */
const MARKER = `marker-${crypto.randomUUID()}`

/** A notice as a template writes it: words, and nothing that leads anywhere. */
function Plain() {
  return (
    <html lang="en">
      <body>
        <p>Your email was changed.</p>
      </body>
    </html>
  )
}

/** A notice stand-in that gained an anchor. */
function WithAnchor() {
  return (
    <html lang="en">
      <body>
        <p>Your email was changed.</p>
        <a href="https://localhost:5443/forgot-password">Help</a>
      </body>
    </html>
  )
}

/** A notice stand-in that writes an address into its text, which a mail client turns into a link. */
function WithAddress() {
  return (
    <html lang="en">
      <body>
        <p>Your email was changed: see https://localhost:5443/me</p>
      </body>
    </html>
  )
}

/** A notice stand-in that fails to render, with a value of the mail in its failure. */
function Broken(): never {
  throw new Error(`no render for ${MARKER}`)
}

const LINK_FOUND = { code: 'mail:LINK_FOUND', message: 'the written notice carries a link' }

describe('renderNotice', () => {
  it('answers the minified HTML and the plain text of a notice that carries no link', async () => {
    const { html, text } = (await renderNotice(<Plain />))._unsafeUnwrap()

    expect(html).toContain('<p>Your email was changed.</p>')
    expect(text).toContain('Your email was changed.')
  })
  it.each([
    ['an anchor', WithAnchor],
    ['an address in its text', WithAddress],
  ])('refuses a notice that carries %s', async (_label, StandIn) => {
    expect((await renderNotice(<StandIn />))._unsafeUnwrapErr()).toStrictEqual(LINK_FOUND)
  })
  it('answers a render that failed by its code and fixed text alone', async () => {
    const error = (await renderNotice(<Broken />))._unsafeUnwrapErr()

    expect(error.code).toBe('mail:RENDER_FAILED')
    expect(JSON.stringify(error)).not.toContain(MARKER)
  })
})
