import type { Mail } from './mail.schema'

/** The first http(s) link a mail's text carries, as a person reading it would follow it. */
export function firstLink(mail: Mail): string {
  const link = /https?:\/\/[^\s<>"]+/.exec(mail.text)?.[0]

  if (link === undefined) {
    throw new Error(`the mail "${mail.subject}" carries no link`)
  }

  return link
}

/** The `token` search parameter of a link, as the front's /verify-email reads it. */
export function linkToken(link: string): string {
  const token = new URL(link).searchParams.get('token')

  if (token === null || token === '') {
    throw new Error(`the link ${new URL(link).pathname} carries no token`)
  }

  return token
}
