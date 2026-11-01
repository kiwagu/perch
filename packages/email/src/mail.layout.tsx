import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components'
import type { ReactNode } from 'react'

import { mailTheme } from './mail.theme'

export interface MailLayoutProps {
  /** The mail's language, for `<html lang>`: the language its strings were taken in. */
  readonly lang: string
  /** The inbox's preview line, read before the mail is opened. */
  readonly preview: string
  /** The product's name, above the card. */
  readonly brand: string
  /** What Perch is, in the footer. */
  readonly tagline: string
  /** Why this address got the mail, in the footer. */
  readonly reason: string
  readonly children: ReactNode
}

const body = {
  backgroundColor: mailTheme.color.surface,
  color: mailTheme.color.foreground,
  fontFamily: mailTheme.font.body,
  margin: '0',
  padding: '24px 0',
}

const container = {
  maxWidth: mailTheme.size.container,
  margin: '0 auto',
  padding: '0 16px',
}

const brandLine = {
  fontSize: '16px',
  fontWeight: '600',
  lineHeight: '24px',
  color: mailTheme.color.foreground,
  margin: '0 0 12px',
}

const card = {
  backgroundColor: mailTheme.color.background,
  border: `1px solid ${mailTheme.color.border}`,
  borderRadius: mailTheme.radius.card,
  padding: '32px 28px',
}

const rule = {
  borderColor: mailTheme.color.border,
  margin: '24px 0 16px',
}

const footnote = {
  fontSize: '12px',
  lineHeight: '18px',
  color: mailTheme.color.muted,
  margin: '0 0 6px',
}

/**
 * The shell every mail shares: the brand line, a card for the mail's own content, a rule and a
 * footer of two lines. Every string is a prop, taken from the catalogs in the mail's language.
 */
export function MailLayout({ lang, preview, brand, tagline, reason, children }: MailLayoutProps) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={brandLine}>{brand}</Text>
          <Section style={card}>{children}</Section>
          <Hr style={rule} />
          <Text style={footnote}>{tagline}</Text>
          <Text style={footnote}>{reason}</Text>
        </Container>
      </Body>
    </Html>
  )
}
