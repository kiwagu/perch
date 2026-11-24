/**
 * A repository at version 4 whose regions written by their buttons clear their area's error on
 * success themselves: a panel with two parts, each a button and its error, and the region of each
 * button writing `clear: <part>.error` in its `onDone`, first, or after another effect (`later`).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { withRows, writeMailLinkRepository } from '../derive/mail-links.fixture'
import { PLATFORM_FILE, SCREENS_DIR, VOCABULARY_FILE } from '../paths'

export const PANEL_FILE = `${SCREENS_DIR}/panel.yaml`

const ACTIONS = `  rename:
    description: Renames the panel.
    params: {}
    result: the panel has its new name
    codes: [ not-allowed, failed ]
    changes: []
  send:
    description: Sends the panel's mail.
    params: {}
    result: the mail is on its way
    codes: [ failed ]
    changes: []
`

const ROWS: Record<string, string> = {
  Codes: '| `not-allowed` | `sample.panel.rename.error` | the account may not do this |',
  'Screen names in use': '| `sample.panel` | the panel of the sample (`/panel`) |',
}

/** The mail area's success: its clear first, or after the clear of the other area's error. */
const mailDone = (later: boolean): string =>
  later
    ? `              - clear: sample.panel.rename.error
              - clear: sample.panel.mail.error
`
    : `              - clear: sample.panel.mail.error
              - clear: sample.panel.rename.error
`

const panel = (
  later: boolean,
): string => `# yaml-language-server: $schema=../../schemas/screen.schema.json
id: sample.panel
title: Panel
description: "The panel of the sample: each of its actions in an area of its own."
flag: null
bindings:
  - path: /panel
    roles: [ identity ]
entry: [ sample.panel.page ]
anchors:
  sample.panel.page:
    kind: page
    description: The root of the screen.
  sample.panel.rename.save-button:
    kind: button
    description: Renames the panel.
    binding: { action: platform.rename }
  sample.panel.rename.error:
    kind: error
  sample.panel.mail.send-button:
    kind: button
    description: Sends the mail.
    binding: { action: platform.send }
  sample.panel.mail.error:
    kind: error
flow:
  initial: viewing
  states:
    viewing:
      type: parallel
      description: The panel, with its areas.
      states:
        rename:
          # renaming, under its own error
          by: sample.panel.rename.save-button
          onDone: { actions: [ { clear: sample.panel.rename.error } ] }
        mail:
          by: sample.panel.mail.send-button
          onDone:
            description: The mail is on its way.
            actions:
${mailDone(later)}`

/** Writes the repository at version 4 into the empty folder `root`, the mail's clear `later` or first. */
export function writeVersionFourRepository(root: string, later: boolean): void {
  writeMailLinkRepository(root, 4, false)
  writeFileSync(
    join(root, PLATFORM_FILE),
    readFileSync(join(root, PLATFORM_FILE), 'utf8').replace('values:\n', `${ACTIONS}values:\n`),
  )

  let vocabulary = readFileSync(join(root, VOCABULARY_FILE), 'utf8')

  for (const [section, rows] of Object.entries(ROWS)) {
    vocabulary = withRows(vocabulary, section, rows)
  }

  writeFileSync(join(root, VOCABULARY_FILE), vocabulary)
  writeFileSync(join(root, PANEL_FILE), panel(later))
}
