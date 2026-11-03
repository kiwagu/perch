import { Heading } from '@react-email/heading'
import { Text } from '@react-email/text'

import { MailLayout, type MailLayoutProps } from '../mail.layout'

import { headingStyle, note, paragraph } from './mail.styles'

export interface NoticeMailProps extends Omit<MailLayoutProps, 'children'> {
  readonly heading: string
  /** The greeting, by the account's name. */
  readonly greeting: string
  /** What happened to the account. */
  readonly body: string
  /** The notes under it, in order. */
  readonly notes: readonly string[]
}

/**
 * A mail that only tells and carries no link at all: a heading, the greeting by name with what
 * happened, and the notes under it. Nothing in it acts, so nothing in it can be followed.
 */
export function NoticeMail(props: NoticeMailProps) {
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
      {props.notes.map((line) => (
        <Text key={line} style={note}>
          {line}
        </Text>
      ))}
    </MailLayout>
  )
}
