import { describe, expect, it } from 'vitest'

import { renderMail } from './mail.render'

const LINK = 'https://localhost:5443/verify-email?token=a.b.c'

/** A recognisable value: no error may carry it. */
const MARKER = `marker-${crypto.randomUUID()}`

/** A mail as a template writes it: the link behind an anchor, so in the HTML and in the text. */
function Linked({ link }: { readonly link: string }) {
  return (
    <html lang="en">
      <body>
        <p>Hello</p>
        <a href={link}>Open</a>
      </body>
    </html>
  )
}

/** A template stand-in that lost its anchor: the link is still written, but behind no button. */
function AnchorLost({ link }: { readonly link: string }) {
  return (
    <html lang="en">
      <body>
        <p>{link}</p>
      </body>
    </html>
  )
}

/** A template stand-in whose anchor points elsewhere than the mail's link. */
function AnchorElsewhere() {
  return (
    <html lang="en">
      <body>
        <a href="https://localhost:5443/verify-email">Open</a>
      </body>
    </html>
  )
}

/** A template stand-in whose anchor the plain text skips, as React Email skips a preview. */
function TextLost({ link }: { readonly link: string }) {
  return (
    <html lang="en">
      <body>
        <div data-skip-in-text="true">
          <a href={link}>Open</a>
        </div>
      </body>
    </html>
  )
}

/** A template stand-in that fails to render, with a value of the mail in its failure. */
function Broken(): never {
  throw new Error(`no render for ${MARKER}`)
}

const LINK_LOST = { code: 'mail:LINK_LOST', message: 'the written mail lost its link' }

describe('renderMail', () => {
  it('answers the minified HTML and the plain text of a mail that carries its link', async () => {
    const { html, text } = (await renderMail(<Linked link={LINK} />, LINK))._unsafeUnwrap()

    expect(html).toContain(`<a href="${LINK}">Open</a>`)
    expect(html).not.toMatch(/>\s*\n\s*</)
    expect(text).toContain(`Open ${LINK}`)
  })
  it('refuses a mail whose HTML carries its link behind no anchor', async () => {
    expect((await renderMail(<AnchorLost link={LINK} />, LINK))._unsafeUnwrapErr()).toStrictEqual(
      LINK_LOST,
    )
  })
  it('refuses a mail whose anchor points elsewhere than its link', async () => {
    expect((await renderMail(<AnchorElsewhere />, LINK))._unsafeUnwrapErr()).toStrictEqual(
      LINK_LOST,
    )
  })
  it('refuses a mail whose plain text lost its link', async () => {
    expect((await renderMail(<TextLost link={LINK} />, LINK))._unsafeUnwrapErr()).toStrictEqual(
      LINK_LOST,
    )
  })
  it('answers a render that failed by its code and fixed text alone', async () => {
    const error = (await renderMail(<Broken />, LINK))._unsafeUnwrapErr()

    expect(error).toStrictEqual({
      code: 'mail:RENDER_FAILED',
      message: 'the mail could not be rendered',
    })
    expect(JSON.stringify(error)).not.toContain(MARKER)
  })
})
