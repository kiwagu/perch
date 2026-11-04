/**
 * Why a mail was not written: its input lies outside what the mails support, or its render failed,
 * lost the link it must carry, or carries one where a notice must carry none. Never with that
 * input: the address, the name or the link.
 */
export interface MailWriteError {
  readonly code:
    | 'mail:LOCALE_UNSUPPORTED'
    | 'mail:LINK_INVALID'
    | 'mail:LINK_LOST'
    | 'mail:LINK_FOUND'
    | 'mail:RENDER_FAILED'
  readonly message: string
}

export const LOCALE_UNSUPPORTED: MailWriteError = {
  code: 'mail:LOCALE_UNSUPPORTED',
  message: 'the mail was asked in a language the mails are not written in',
}

export const LINK_INVALID: MailWriteError = {
  code: 'mail:LINK_INVALID',
  message: 'the link of the mail is not an http or https address',
}

export const LINK_LOST: MailWriteError = {
  code: 'mail:LINK_LOST',
  message: 'the written mail lost its link',
}

export const LINK_FOUND: MailWriteError = {
  code: 'mail:LINK_FOUND',
  message: 'the written notice carries a link',
}

export const RENDER_FAILED: MailWriteError = {
  code: 'mail:RENDER_FAILED',
  message: 'the mail could not be rendered',
}
