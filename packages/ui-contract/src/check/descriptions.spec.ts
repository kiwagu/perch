import { describe, expect, it } from 'vitest'

import { formatProblem, type WrittenDescription } from '../files'
import { DESCRIPTION_PURPOSES } from '../schemas'

import { sampleContract } from './contract.fixture'
import { descriptionsProblems } from './descriptions'

const FRAME = 'contract/domain/screens/__root.yaml'

/** The theme select's description as the description diet left it: 191 characters. */
const DIETED =
  "The theme of this device, for anyone, a guest included: light, dark or the device's own setting; a choice applies at once and stays on this device, the same theme the settings screen chooses."

/** The same description a card later grew back clause by clause: 340 characters. */
const REGROWN =
  "The theme of this device for a guest: light, dark or the device's own setting, starting as the theme this device showed last; a choice applies at once, stays on this device, and is the theme an account created here starts with; a signed-in account chooses its theme on its settings screen, and the theme its settings store applies here too."

const anchor = (text: string): WrittenDescription => ({
  file: FRAME,
  line: 43,
  at: ['anchors', 'app-shell.theme-select', 'description'],
  kind: 'anchor',
  place: 'app-shell.theme-select',
  text,
})

const printed = (...descriptions: WrittenDescription[]): string[] =>
  descriptionsProblems({ ...sampleContract(), descriptions }).map(formatProblem)

describe('descriptionsProblems', () => {
  it('passes a description within its budget of 200 characters, 200 itself included', () => {
    expect(DIETED).toHaveLength(191)
    expect(printed(anchor(DIETED), anchor('x'.repeat(200)))).toEqual([])
  })
  it('names a description past it by its file, line, place and length, with the purpose of its field', () => {
    expect(REGROWN).toHaveLength(340)
    expect(printed(anchor(REGROWN))).toEqual([
      `${FRAME}:43: anchors["app-shell.theme-select"].description: the description of app-shell.theme-select is 340 characters, past its budget of 200; its purpose: "${DESCRIPTION_PURPOSES.anchor}"`,
    ])
  })
  it("holds every place to the one budget, a screen's own description included, each with its own purpose", () => {
    const long = 'y'.repeat(201)

    expect(
      printed(
        {
          file: FRAME,
          line: 4,
          at: ['description'],
          kind: 'screen',
          place: 'app-shell',
          text: long,
        },
        {
          file: 'contract/domain/model.schema.json',
          at: ['$defs', 'thing', 'description'],
          kind: 'entity',
          place: 'model entity thing',
          text: long,
        },
      ),
    ).toEqual([
      `${FRAME}:4: description: the description of app-shell is 201 characters, past its budget of 200; its purpose: "${DESCRIPTION_PURPOSES.screen}"`,
      `contract/domain/model.schema.json:1: $defs.thing.description: the description of model entity thing is 201 characters, past its budget of 200; its purpose: "${DESCRIPTION_PURPOSES.entity}"`,
    ])
  })
  it('counts characters, not the units of a string', () => {
    expect(printed(anchor('😀'.repeat(200)))).toEqual([])
  })
})
