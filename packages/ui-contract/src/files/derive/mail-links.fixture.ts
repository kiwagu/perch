/**
 * A repository for the specs of a screen a mail links to: the package's fixture repository at a
 * version, with a platform action whose mail links to a landing screen and the platform value of
 * the token the link carries, the landing writing that token's search parameter itself (version
 * 3) or leaving it out (version 4).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeContractRepository } from '../../contract-repository.fixture'
import { PLATFORM_FILE, VOCABULARY_FILE } from '../paths'

export const LANDING_FILE = 'contract/domain/screens/landing.yaml'

const PLATFORM_ADDITIONS = `  open:
    description: Opens what a token names.
    params:
      token:
        value: token
        codes: [ link-invalid, link-expired ]
        description: The token the link of the mail carries.
    result: the landing shows what the token names
    codes: [ link-invalid, link-expired, failed ]
    changes: []
  invite:
    description: Sends the mail whose link opens the landing.
    params:
      email: { type: string, maxLength: 254, description: Who the mail goes to. }
    result: the mail is on its way
    codes: [ failed ]
    changes: []
    mail:
      to: email
      language: account
      link: { screen: sample.landing, search: token }
values:
  token:
    type: string
    minLength: 1
    maxLength: 4096
    description: The token the link of a mail carries.
    examples: [ token-0123456789abcdef ]
`

const ROWS: Record<string, string> = {
  Kinds: '| `error` | a failure text | |',
  Codes:
    '| `link-invalid` | `sample.landing.error` | the link is unknown, used or replaced |\n| `link-expired` | `sample.landing.error` | the link is too old |',
  'Screen names in use': '| `sample.landing` | what the link of the mail opens (`/landing`) |',
}

/** The landing the link opens: it writes the token's parameter itself (version 3) or leaves it out. */
const landingText = (written: boolean): string => `id: sample.landing
title: Landing
description: What the link of the mail opens.
flag: null
bindings:
  - path: /landing
    roles: [ guest, identity ]
${
  written
    ? `    search:
      type: object
      properties:
        token:
          type: string
          minLength: 1
          maxLength: 4096
          description: The token the link of a mail carries.
          examples: [ token-0123456789abcdef ]
      additionalProperties: false
`
    : ''
}entry: [ sample.landing.page, sample.landing.error ]
anchors:
  sample.landing.page:
    kind: page
    description: The root of the screen.
  sample.landing.error:
    kind: error
    description: Why the token did not open the landing.
flow:
  initial: opening
  states:
    opening:
      invoke:
        src: platform.open
        input: { token: { search: token } }
        onDone: done
        onError: failed
    done:
      type: final
    failed:
      type: final
`

/** `markdown` with `rows` appended to the table of `section`. */
export function withRows(markdown: string, section: string, rows: string): string {
  const start = markdown.indexOf(`## ${section}\n`)
  const next = markdown.indexOf('\n## ', start + 1)
  const end = next === -1 ? markdown.length : next

  return `${markdown.slice(0, end).trimEnd()}\n${rows}\n${markdown.slice(end)}`
}

/** Writes the sample at `version` into the empty folder `root`, the landing's parameter `written` or left out. */
export function writeMailLinkRepository(root: string, version: number, written: boolean): void {
  writeContractRepository(root)
  writeFileSync(
    join(root, PLATFORM_FILE),
    readFileSync(join(root, PLATFORM_FILE), 'utf8')
      .replace('version: 1', `version: ${version}`)
      .replace('reserved:', `${PLATFORM_ADDITIONS}reserved:`),
  )

  let vocabulary = readFileSync(join(root, VOCABULARY_FILE), 'utf8').replace(
    'Contract version: 1\n\n',
    '',
  )

  for (const [section, rows] of Object.entries(ROWS)) {
    vocabulary = withRows(vocabulary, section, rows)
  }

  writeFileSync(join(root, VOCABULARY_FILE), vocabulary)
  writeFileSync(join(root, LANDING_FILE), landingText(written))
}
