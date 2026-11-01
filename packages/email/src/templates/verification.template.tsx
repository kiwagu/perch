import { Button, Heading, Link, Section, Text } from '@react-email/components'

import { MailLayout, type MailLayoutProps } from '../mail.layout'
import { mailTheme } from '../mail.theme'

export interface VerificationMailProps extends Omit<MailLayoutProps, 'children'> {
  readonly heading: string
  /** The greeting, by the account's name. */
  readonly greeting: string
  /** What the link does, naming the address it confirms. */
  readonly body: string
  /** The button's label. */
  readonly action: string
  /** The front's screen that verifies the email, with the link's token. */
  readonly link: string
  /** The line above the raw link, for a client that strips the button. */
  readonly fallback: string
  /** How long the link works. */
  readonly expiry: string
  /** What to do with a mail nobody asked for. */
  readonly ignore: string
}

const headingStyle = {
  fontSize: '20px',
  lineHeight: '28px',
  fontWeight: '600',
  color: mailTheme.color.foreground,
  margin: '0 0 12px',
}

const paragraph = {
  fontSize: '15px',
  lineHeight: '24px',
  color: mailTheme.color.foreground,
  margin: '0 0 24px',
}

const button = {
  backgroundColor: mailTheme.color.button,
  color: mailTheme.color.buttonForeground,
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  borderRadius: mailTheme.radius.button,
  padding: '12px 20px',
}

const fallbackLabel = {
  fontSize: '12px',
  lineHeight: '18px',
  color: mailTheme.color.muted,
  margin: '28px 0 4px',
}

const fallbackLine = {
  fontFamily: mailTheme.font.mono,
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0',
  wordBreak: 'break-all' as const,
}

const fallbackLink = {
  color: mailTheme.color.muted,
  textDecorationLine: 'underline',
}

const note = {
  fontSize: '13px',
  lineHeight: '20px',
  color: mailTheme.color.muted,
  margin: '20px 0 0',
}

/**
 * The mail whose link verifies an account's email: a heading, the greeting by name with what the
 * link does, the button, the raw link for a client that strips buttons, how long the link works,
 * and what to do with a mail nobody asked for.
 */
export function VerificationMail(props: VerificationMailProps) {
  return (
    <MailLayout
      lang={props.lang}
      preview={props.preview}
      brand={props.brand}
      tagline={props.tagline}
      reason={props.reason}
    >
      <Heading as="h1" style={headingStyle}>
        {props.heading}
      </Heading>
      <Text style={paragraph}>
        {props.greeting}
        <br />
        {props.body}
      </Text>
      <Section>
        <Button href={props.link} style={button}>
          {props.action}
        </Button>
      </Section>
      <Text style={fallbackLabel}>{props.fallback}</Text>
      <Text style={fallbackLine}>
        <Link href={props.link} style={fallbackLink}>
          {props.link}
        </Link>
      </Text>
      <Text style={note}>{props.expiry}</Text>
      <Text style={note}>{props.ignore}</Text>
    </MailLayout>
  )
}
