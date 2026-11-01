import { describe, expect, it } from 'vitest'

import { renderMail } from './mail.render'

const LINK = 'https://localhost:5443/verify-email?token=a.b.c'

/** A link of the characters HTML escapes in an attribute: its anchors carry it as entities. */
const ESCAPED_LINK = `https://localhost:5443/verify-email?token=a"b'c&d<e>`

/** A recognisable value: no error may carry it. */
const MARKER = `marker-${crypto.randomUUID()}`

interface StandInProps {
  readonly link: string
}

/**
 * A mail as a template writes it: its button, the anchor marked as the mail's primary action,
 * and the raw link once more for a client that strips buttons, both leading to the link.
 */
function Complete({ link }: StandInProps) {
  return (
    <html lang="en">
      <body>
        <p>Hello</p>
        <a data-mail-action="primary" href={link}>
          Open
        </a>
        <p>
          <a href={link}>{link}</a>
        </p>
      </body>
    </html>
  )
}

/** A template stand-in whose button lost its href, while the raw link still leads to the link. */
function ButtonHrefMissing({ link }: StandInProps) {
  return (
    <html lang="en">
      <body>
        {/* biome-ignore lint/a11y/useValidAnchor: the stand-in's button lost its href on purpose */}
        <a data-mail-action="primary">Open</a>
        <p>
          <a href={link}>{link}</a>
        </p>
      </body>
    </html>
  )
}

/** A template stand-in whose button leads elsewhere, while the raw link still leads to the link. */
function ButtonHrefChanged({ link }: StandInProps) {
  return (
    <html lang="en">
      <body>
        <a data-mail-action="primary" href="https://localhost:5443/verify-email">
          Open
        </a>
        <p>
          <a href={link}>{link}</a>
        </p>
      </body>
    </html>
  )
}

/** A template stand-in that lost its button: only the raw link is left. */
function ButtonMissing({ link }: StandInProps) {
  return (
    <html lang="en">
      <body>
        <p>
          <a href={link}>{link}</a>
        </p>
      </body>
    </html>
  )
}

/** A template stand-in with two buttons marked as the primary action: which one is it? */
function TwoButtons({ link }: StandInProps) {
  return (
    <html lang="en">
      <body>
        <a data-mail-action="primary" href={link}>
          Open
        </a>
        <a data-mail-action="primary" href={link}>
          Open too
        </a>
        <p>
          <a href={link}>{link}</a>
        </p>
      </body>
    </html>
  )
}

/** A template stand-in whose raw link lost its anchor: the link is written, but leads nowhere. */
function FallbackLost({ link }: StandInProps) {
  return (
    <html lang="en">
      <body>
        <a data-mail-action="primary" href={link}>
          Open
        </a>
        <p>{link}</p>
      </body>
    </html>
  )
}

/** A template stand-in whose anchors the plain text skips, as React Email skips a preview. */
function TextLost({ link }: StandInProps) {
  return (
    <html lang="en">
      <body>
        <div data-skip-in-text="true">
          <a data-mail-action="primary" href={link}>
            Open
          </a>
          <a href={link}>{link}</a>
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
  it('answers the minified HTML and the plain text of a mail whose button and raw link lead to its link', async () => {
    const { html, text } = (await renderMail(<Complete link={LINK} />, LINK))._unsafeUnwrap()

    expect(html).toContain(`<a data-mail-action="primary" href="${LINK}">Open</a>`)
    expect(html).not.toMatch(/>\s*\n\s*</)
    expect(text).toContain(`Open ${LINK}`)
  })
  it('takes a link that the anchors carry as entities, as a parser decodes them', async () => {
    const { html, text } = (
      await renderMail(<Complete link={ESCAPED_LINK} />, ESCAPED_LINK)
    )._unsafeUnwrap()

    expect(html).toContain('token=a&quot;b&#x27;c&amp;d&lt;e&gt;')
    expect(text).toContain(ESCAPED_LINK)
  })
  it.each([
    ['its button lost its href', ButtonHrefMissing],
    ['its button leads elsewhere', ButtonHrefChanged],
    ['it has no button', ButtonMissing],
    ['it has two buttons', TwoButtons],
    ['its raw link lost its anchor', FallbackLost],
    ['its plain text lost the link', TextLost],
  ])('refuses a mail when %s, its other anchors notwithstanding', async (_label, StandIn) => {
    expect((await renderMail(<StandIn link={LINK} />, LINK))._unsafeUnwrapErr()).toStrictEqual(
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
