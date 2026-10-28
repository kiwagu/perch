import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import { loadScreens } from './load'

const FIXTURE = join(import.meta.dirname, '../../__fixtures__/contract')
const SAMPLE_FILE = 'contract/domain/screens/sample/$key.yaml'
const FRAME_FILE = 'contract/domain/screens/__root.yaml'
const DIALOG = 'app-shell.confirmation'

let root: string

/** The frame, with the confirmation when `confirming`, and `extra` on it. */
function writeFrame(confirming: boolean, extra: Record<string, unknown> = {}): void {
  const anchors: Record<string, unknown> = { 'app-shell.page': { kind: 'page' } }

  if (confirming) {
    anchors[DIALOG] = {
      kind: 'confirmation',
      derived: ['confirm-button', 'cancel-button'],
      ...extra,
    }
  }

  writeFileSync(
    join(root, FRAME_FILE),
    stringify({
      id: 'app-shell',
      title: 'The frame',
      description: 'What the frame is for.',
      frame: true,
      flag: null,
      bindings: [],
      entry: ['app-shell.page'],
      anchors,
    }),
  )
}

/** The fixture's screen with `anchors` added. */
function writeSample(anchors: Record<string, unknown>): void {
  const screen = parse(readFileSync(join(root, SAMPLE_FILE), 'utf8')) as Record<string, unknown>

  screen['anchors'] = { ...(screen['anchors'] as Record<string, unknown>), ...anchors }
  writeFileSync(join(root, SAMPLE_FILE), stringify(screen))
}

const deleting = {
  kind: 'button',
  binding: { action: 'thing.deleteThing', params: { id: 'sample.list.item' } },
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-questions-'))
  cpSync(FIXTURE, join(root, 'contract'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the question before a destructive action', () => {
  it("is derived on the control, and the frame's confirmation carries its code", () => {
    writeFrame(true)
    writeSample({ 'sample.list.delete-button': deleting })

    const { screens, problems } = loadScreens(root)
    const anchorOf = (screen: string, anchor: string) =>
      screens?.screens.find(({ id }) => id === screen)?.anchors[anchor]

    expect(problems).toEqual([])
    expect(anchorOf('sample', 'sample.list.delete-button')?.asks).toEqual({
      dialog: DIALOG,
      code: 'thing-delete',
    })
    expect(anchorOf('app-shell', DIALOG)?.codes).toEqual(['thing-delete'])
    expect(screens?.questions).toEqual([
      { anchor: DIALOG, code: 'thing-delete', action: 'thing.deleteThing' },
    ])
  })

  it('asks nothing without a confirmation on the frame', () => {
    writeFrame(false)
    writeSample({ 'sample.list.delete-button': deleting })

    const { screens, problems } = loadScreens(root)

    expect(problems).toEqual([])
    expect(
      screens?.screens.find(({ id }) => id === 'sample')?.anchors['sample.list.delete-button']
        ?.asks,
    ).toBeUndefined()
    expect(screens?.questions).toEqual([])
  })

  it('asks nothing for a control that bans it, and refuses a ban on a control that destroys nothing', () => {
    writeFrame(true)
    writeSample({
      'sample.list.delete-button': { ...deleting, confirm: false },
      'sample.list.open-button': { kind: 'button', binding: { route: '/' }, confirm: false },
    })

    const { problems } = loadScreens(root)

    expect(problems).toEqual([
      {
        file: SAMPLE_FILE,
        message:
          'anchors["sample.list.open-button"].confirm: confirm: false bans no question: the control runs no destructive action',
      },
    ])
  })

  it("refuses codes the frame writes on its confirmation, which carries every question's code", () => {
    writeFrame(true, { codes: [] })
    writeSample({ 'sample.list.delete-button': deleting })

    const { screens, problems } = loadScreens(root)

    expect(problems).toEqual([
      {
        file: FRAME_FILE,
        message:
          'anchors["app-shell.confirmation"].codes: the codes of the confirmation are derived from the questions its controls ask: the frame writes none',
      },
    ])
    expect(screens).toBeUndefined()
  })
})
