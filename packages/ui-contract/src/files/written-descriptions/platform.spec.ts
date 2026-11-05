import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { platformDescriptions } from './platform'

const PLATFORM = `
version: 1
actions:
  sign-out:
    description: Signs this device out.
    params:
      forgetUnsent: { type: boolean, description: Drop the unsent changes. }
      quiet: { type: boolean, description: "" }
    result: this device signs out, and what it never sent is gone
    codes: [ failed ]
  devices.list:
    description: Lists the devices.
    params: {}
    result: the devices of the account
    codes: []
events:
  opened: The data of this device opened.
composites:
  password-rules:
    description: The rules a new password keeps.
    list: password-rule-list
    itemState: met
    items:
      length: 10 to 35 characters.
reserved: [ app-shell.status ]
status: { anchor: app-shell.status, states: [ opening, ready ] }
`

describe('platformDescriptions', () => {
  it("reads the descriptions of the actions and their parameters, the events and the composites, never an action's result", () => {
    expect(platformDescriptions(parse(PLATFORM))).toEqual([
      {
        at: ['actions', 'sign-out', 'description'],
        kind: 'action',
        place: 'platform action sign-out',
        text: 'Signs this device out.',
      },
      {
        at: ['actions', 'sign-out', 'params', 'forgetUnsent', 'description'],
        kind: 'actionParameter',
        place: 'platform action sign-out param forgetUnsent',
        text: 'Drop the unsent changes.',
      },
      {
        at: ['actions', 'sign-out', 'params', 'quiet', 'description'],
        kind: 'actionParameter',
        place: 'platform action sign-out param quiet',
        text: '',
      },
      {
        at: ['actions', 'devices.list', 'description'],
        kind: 'action',
        place: 'platform action devices.list',
        text: 'Lists the devices.',
      },
      {
        at: ['events', 'opened'],
        kind: 'event',
        place: 'platform event opened',
        text: 'The data of this device opened.',
      },
      {
        at: ['composites', 'password-rules', 'description'],
        kind: 'composite',
        place: 'platform composite password-rules',
        text: 'The rules a new password keeps.',
      },
    ])
  })
})
