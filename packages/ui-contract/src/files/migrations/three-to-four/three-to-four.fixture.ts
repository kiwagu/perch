/**
 * A repository at version 3 that writes everything version 4 derives: the landing a mail links
 * to with its token's parameter written, and an account screen with a select, a dialog, a link
 * whose roles its route gives, and a new password typed twice with the four guards of the pair.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { withRows, writeMailLinkRepository } from '../../derive/mail-links.fixture'
import { PLATFORM_FILE, SCREENS_DIR, VOCABULARY_FILE } from '../../paths'

export const ACCOUNT_FILE = `${SCREENS_DIR}/account.yaml`

const SET_PASSWORD = `  set-password:
    description: Sets a new password.
    params:
      password: { value: new-password, description: The new password. }
    result: the password is the new one
    codes: [ failed ]
    changes: []
`

const NEW_PASSWORD = `  new-password:
    type: string
    minLength: 10
    maxLength: 35
    description: A new password, kept to its rules.
`

const COMPOSITES = `composites:
  password-rules:
    description: The rules a new password keeps.
    list: password-rule-list
    itemState: met
    items:
      length: 10 to 35 characters.
      digit: At least one digit.
`

const ROWS: Record<string, string> = {
  Kinds: '| `dialog` | a question | |\n| `link` | a link | |\n| `select` | a choice | |',
  'Derived suffixes':
    '| `cancel-button` | the other answer of a dialog |\n| `visibility-button` | the eye of a password input |',
  'Row states': '| `met` | the items of `password-rules` | the password typed keeps this rule |',
  Codes: '| `passwords-differ` | `sample.account.error` | the password typed again differs |',
  'Screen names in use': '| `sample.account` | the account of the sample (`/account`) |',
  Composites: '| `password-rules` | the rules a new password keeps |',
}

/** The four guards of a password pair, each with the sentence a screen file wrote for it. */
const GUARDS = `      passwordBreaksRules: the password breaks one of the rules of sample.account.password-rule-list
      passwordsDiffer: the password typed again is not the same as the password
      confirmationStrays: "the password typed again is no longer how the password begins: a character differs"
      confirmationFollows: the password typed again is how the password begins, all of it or a part
`

/** The account screen written in full, as a contract at version 3 writes it. */
const ACCOUNT = `# yaml-language-server: $schema=../../schemas/screen.schema.json
id: sample.account
title: "Account"
description: Where the account of the sample is edited, its language chosen and its password set twice, in a description long enough to run past the eighty columns.
flag: null
bindings: [ { path: /account, roles: [ guest, identity, member ] } ]
entry: [ sample.account.page ]
anchors:
  sample.account.page:
    kind: page
    description: The root of the screen.
  sample.account.language-select:
    kind: select
    description: The language of the screen.
    dataValue: true
    derived: [ option ]
  sample.account.leave-dialog:
    kind: dialog
    description: Asks whether to leave.
    derived: [ confirm-button, cancel-button ]
  sample.account.thing-link:
    kind: link
    description: Opens the thing.
    binding: { route: /sample/$key }
    roles: [ member ]
  # the new password, typed twice
  sample.account.password-input:
    kind: input
    secret: true
    composite: password-rules
    description: The new password.
    binding: { action: platform.set-password, params: { password: sample.account.password-input } }
    derived: [ visibility-button ]
  sample.account.password-confirmation-input:
    kind: input
    secret: true
    description: The new password typed again; never sent.
    derived: [ visibility-button ]
  sample.account.submit-button:
    kind: button
    description: Sets the new password.
    binding: { action: platform.set-password }
  sample.account.error:
    kind: error
    description: Why the password is not set.
    fields: { passwords-differ: sample.account.password-confirmation-input }
flow:
  initial: weak
  meta:
    guards:
${GUARDS}  states:
    weak:
      on:
        sample.account.password-input:
          - guard: passwordBreaksRules
          - target: differing
            guard: confirmationStrays
          - target: kept
    kept:
      on:
        sample.account.password-input:
          - target: weak
            guard: passwordBreaksRules
          - target: differing
            guard: confirmationStrays
        sample.account.password-confirmation-input:
          target: differing
          guard: confirmationStrays
        sample.account.submit-button:
          - target: differing
            guard: passwordsDiffer
          - target: setting
    differing:
      entry:
        - show: { sample.account.error: [ passwords-differ ] }
      exit:
        - clear: sample.account.error
      on:
        sample.account.password-input:
          - target: weak
            guard: passwordBreaksRules
          - target: kept
            guard: confirmationFollows
        sample.account.password-confirmation-input:
          target: kept
          guard: confirmationFollows
    setting:
      invoke:
        src: platform.set-password
        input: { password: sample.account.password-input }
        onDone: done
        onError:
          target: kept
          actions:
            - show: sample.account.error
    done:
      type: final
`

/** Writes the repository at version 3 into the empty folder `root`. */
export function writeVersionThreeRepository(root: string): void {
  writeMailLinkRepository(root, 3, true)
  writeFileSync(
    join(root, PLATFORM_FILE),
    readFileSync(join(root, PLATFORM_FILE), 'utf8')
      .replace('values:\n', `${SET_PASSWORD}values:\n${NEW_PASSWORD}`)
      .replace('reserved:', `${COMPOSITES}reserved:`),
  )

  let vocabulary = readFileSync(join(root, VOCABULARY_FILE), 'utf8')

  for (const [section, rows] of Object.entries(ROWS)) {
    vocabulary = withRows(vocabulary, section, rows)
  }

  writeFileSync(join(root, VOCABULARY_FILE), vocabulary)
  writeFileSync(join(root, ACCOUNT_FILE), ACCOUNT)
}
