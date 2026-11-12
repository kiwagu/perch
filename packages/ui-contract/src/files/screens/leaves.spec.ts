import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import { loadScreens } from './load'

const FIXTURE = join(import.meta.dirname, '../../__fixtures__/contract')
const SAMPLE_FILE = 'contract/domain/screens/sample/$key.yaml'
const PLATFORM_FILE = 'contract/domain/platform.yaml'
const DIALOG = 'app-shell.leave-dialog'
const LINK = 'sample.help-link'

let root: string

/** `edit` applied to the YAML of `file`. */
function rewrite(file: string, edit: (read: Record<string, unknown>) => void): void {
  const read = parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>

  edit(read)
  writeFileSync(join(root, file), stringify(read))
}

/** The platform declaring how leaves ask, a change of screen as `screen` says. */
function writePolicy(screen: 'question' | 'never'): void {
  rewrite(PLATFORM_FILE, (platform) => {
    platform['unsavedInput'] = {
      question: DIALOG,
      screen,
      actions: 'never',
      unload: 'browser',
      state: 'never',
      flow: 'never',
      elsewhere: 'cannot',
    }
  })
}

/** The sample with a help link, written as `link`, whose event moves to another screen. */
function writeHelpLink(link: Record<string, unknown> = { kind: 'link' }): void {
  rewrite(SAMPLE_FILE, (screen) => {
    const flow = screen['flow'] as { states: { editing: { on: Record<string, unknown> } } }

    screen['anchors'] = { ...(screen['anchors'] as Record<string, unknown>), [LINK]: link }
    flow.states.editing.on[LINK] = { target: 'editing', actions: [{ navigate: '/help' }] }
  })
}

const linkOf = (screens: ReturnType<typeof loadScreens>['screens']) =>
  screens?.screens.find(({ id }) => id === 'sample')?.anchors[LINK]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-leaves-'))
  cpSync(FIXTURE, join(root, 'contract'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the question before a leave a control makes', () => {
  it('is derived on the control from its expanded flow, losing the fields that hold input', () => {
    writePolicy('question')
    writeHelpLink()

    const { screens, problems } = loadScreens(root)

    expect(problems).toEqual([])
    expect(linkOf(screens)?.leaves).toEqual({ dialog: DIALOG, loses: ['sample.title-input'] })
  })

  it('is not derived while a change of screen never asks', () => {
    writePolicy('never')
    writeHelpLink()

    const { screens, problems } = loadScreens(root)

    expect(problems).toEqual([])
    expect(linkOf(screens)?.leaves).toBeUndefined()
  })

  it('is refused when a screen file writes it', () => {
    writePolicy('question')
    writeHelpLink({ kind: 'link', leaves: { dialog: DIALOG, loses: ['sample.title-input'] } })

    const { problems } = loadScreens(root)

    expect(problems).toEqual([
      {
        file: SAMPLE_FILE,
        message: `anchors["${LINK}"].leaves: leaves is derived from the control's flow: a screen file never writes it`,
      },
    ])
  })
})
