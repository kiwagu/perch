import { mailTheme } from '../mail.theme'

/** The heading of a mail's card. */
export const headingStyle = {
  fontSize: '20px',
  lineHeight: '28px',
  fontWeight: '600',
  color: mailTheme.color.foreground,
  margin: '0 0 12px',
}

/** The greeting and what the mail is about. */
export const paragraph = {
  fontSize: '15px',
  lineHeight: '24px',
  color: mailTheme.color.foreground,
  margin: '0 0 24px',
}

/** The mail's primary action. */
export const button = {
  backgroundColor: mailTheme.color.button,
  color: mailTheme.color.buttonForeground,
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  borderRadius: mailTheme.radius.button,
  padding: '12px 20px',
}

/** The line above the raw link. */
export const fallbackLabel = {
  fontSize: '12px',
  lineHeight: '18px',
  color: mailTheme.color.muted,
  margin: '28px 0 4px',
}

/** The raw link, for a client that strips the button. */
export const fallbackLine = {
  fontFamily: mailTheme.font.mono,
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0',
  wordBreak: 'break-all' as const,
}

export const fallbackLink = {
  color: mailTheme.color.muted,
  textDecorationLine: 'underline',
}

/** A note under the card's content: how long a link works, what to do with an unasked mail. */
export const note = {
  fontSize: '13px',
  lineHeight: '20px',
  color: mailTheme.color.muted,
  margin: '20px 0 0',
}
