import type { Mail } from './mail.schema'

// The failures below say what went wrong in fixed words: a mail's subject and its link may
// carry the address, so neither appears in them.

/** The first http(s) link a mail's text carries, as a person reading it would follow it. */
export function firstLink(mail: Mail): string {
  const link = /https?:\/\/[^\s<>"]+/.exec(mail.text)?.[0]

  if (link === undefined) {
    throw new Error('the mail carries no link')
  }

  return link
}

/** The `token` search parameter of a link, as the front's /verify-email reads it. */
export function linkToken(link: string): string {
  const url = URL.parse(link)

  if (url === null) {
    throw new Error('the link is not a URL')
  }

  const token = url.searchParams.get('token')

  if (token === null || token === '') {
    throw new Error('the link carries no token')
  }

  return token
}
