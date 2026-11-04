import { Button } from '@react-email/button'
import { Heading } from '@react-email/heading'
import { Link } from '@react-email/link'
import { Section } from '@react-email/section'
import { Text } from '@react-email/text'

import { primaryAction } from '../mail.action'
import { MailLayout, type MailLayoutProps } from '../mail.layout'

import {
  button,
  fallbackLabel,
  fallbackLine,
  fallbackLink,
  headingStyle,
  note,
  paragraph,
} from './mail.styles'

export interface ActionMailProps extends Omit<MailLayoutProps, 'children'> {
  readonly heading: string
  /** The greeting, by the account's name. */
  readonly greeting: string
  /** What the mail is about and what its link does. */
  readonly body: string
  /** The button's label. */
  readonly action: string
  /** Where the button leads: a screen of the front, with the link's token when it carries one. */
  readonly link: string
  /** The line above the raw link, for a client that strips the button. */
  readonly fallback: string
  /** The notes under the link, in order: how long it works, what to do with an unasked mail. */
  readonly notes: readonly string[]
}

/**
 * A mail with one action: a heading, the greeting by name with what the mail is about, the button,
 * the raw link for a client that strips buttons, and the notes under it. The verification mail,
 * the reset mail, the confirmation of a new email and the notice of a changed password are each
 * one, with their own strings.
 */
export function ActionMail(props: ActionMailProps) {
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
        <Button {...primaryAction} href={props.link} style={button}>
          {props.action}
        </Button>
      </Section>
      <Text style={fallbackLabel}>{props.fallback}</Text>
      <Text style={fallbackLine}>
        <Link href={props.link} style={fallbackLink}>
          {props.link}
        </Link>
      </Text>
      {props.notes.map((line) => (
        <Text key={line} style={note}>
          {line}
        </Text>
      ))}
    </MailLayout>
  )
}
