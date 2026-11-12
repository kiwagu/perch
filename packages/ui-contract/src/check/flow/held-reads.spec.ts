import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import {
  CONTRACT_DIR,
  formatProblem,
  MODEL_FILE,
  PLATFORM_FILE,
  SCENARIOS_DIR,
  VOCABULARY_FILE,
} from '../../files'
import { contractAt } from '../../manifest/manifest.fixture'
import type { Contract } from '../contract'
import { flowIn, flowStateIn, sampleContract, screenIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract: Contract): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow'

const read = (anchor: string) => ({ type: 'read', params: { anchor } }) as const

const DEVICES = 'sample.devices.list'

/** The problem of a branch that does not read `list`, which the invoke holds for `reasons`. */
const unread = (at: string, list: string, src: string, reasons: string): string =>
  `${AT}.${at}: "${list}" may show another answer once ${src} succeeds, as ${reasons}: this outcome reads it, read: ${list}, or says nothing reads after it, read: false`

/**
 * The sample with its devices in a part of their own: a list whose source is `devices.list`,
 * an entry for each device, and a button in it that revokes the device it is in, which
 * `revoking` runs and after which it reads the list. The sample's own list follows its things.
 */
function withDevices(): Contract {
  const contract = sampleContract()
  const screen = screenIn(contract, 'sample')
  const { 'sample.devices-list': _beside, ...anchors } = screen.anchors

  screen.anchors = {
    ...anchors,
    [DEVICES]: { kind: 'list', source: { platform: 'devices.list' } },
    'sample.devices.device-item': { kind: 'item', dataId: 'device' },
    'sample.devices.revoke-button': {
      kind: 'button',
      binding: {
        action: 'platform.devices.revoke',
        params: { device: 'sample.devices.device-item' },
      },
    },
  }
  contract.screens.platform.actions['devices.revoke'] = {
    description: 'Signs a device out.',
    params: { device: { type: 'string', description: 'The device.' } },
    result: 'the device is signed out',
    codes: ['failed'],
    changes: [],
  }
  Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
    'sample.devices.revoke-button': { target: 'revoking' },
  })
  flowIn(contract).states['revoking'] = {
    invoke: {
      src: 'platform.devices.revoke',
      input: { device: 'sample.devices.device-item' },
      onDone: { target: 'editing', actions: [read(DEVICES)] },
      onError: { target: 'editing' },
    },
  }

  return contract
}

/** The invoke of the plain state `name` of the sample's flow. */
const invokeIn = (contract: Contract, name: string) =>
  flowStateIn(contract, name).invoke ?? expect.unreachable(`an invoke in ${name}`)

/** The action `name` of the sample's model. */
const modelActionIn = (contract: Contract, name: string) =>
  contract.model.entities['thing']?.actions[name] ?? expect.unreachable(`the action ${name}`)

describe('flowProblems and the reads an invoke holds', () => {
  it('finds nothing where each outcome after an action reads what it holds', () => {
    expect(printed(withDevices())).toEqual([])
  })
  it('holds a list whose entry the input takes', () => {
    const contract = withDevices()

    invokeIn(contract, 'revoking').onDone = { target: 'editing' }

    expect(printed(contract)).toEqual([
      unread(
        'states.revoking.invoke.onDone',
        DEVICES,
        'platform.devices.revoke',
        'the input device takes "sample.devices.device-item", an entry of it',
      ),
    ])
  })
  it('holds a list whose source takes a value the input takes too', () => {
    const contract = withDevices()
    const devices = screenIn(contract, 'sample').anchors[DEVICES]

    Object.assign(devices ?? {}, {
      source: { platform: 'devices.list', params: { tab: { search: 'tab' } } },
    })
    invokeIn(contract, 'saving').input = { title: { search: 'tab' } }

    expect(printed(contract)).toEqual([
      unread(
        'states.saving.invoke.onDone',
        DEVICES,
        'thing.updateThing',
        'the input title takes {"search":"tab"}, which its source devices.list takes for tab',
      ),
    ])
  })
  it('holds a list whose source the changes of a platform action name', () => {
    const contract = withDevices()
    const revoking = invokeIn(contract, 'revoking')

    Object.assign(contract.screens.platform.actions['devices.revoke'] ?? {}, {
      changes: ['devices.list'],
    })
    revoking.input = {}
    revoking.onDone = { target: 'editing' }

    expect(printed(contract)).toEqual([
      unread(
        'states.revoking.invoke.onDone',
        DEVICES,
        'platform.devices.revoke',
        'the action changes devices.list, its source',
      ),
    ])
  })
  it('holds a list whose source the changes of an action of the model name', () => {
    const contract = withDevices()

    modelActionIn(contract, 'updateThing').changes = ['devices.list']

    expect(printed(contract)).toEqual([
      unread(
        'states.saving.invoke.onDone',
        DEVICES,
        'thing.updateThing',
        'the action changes devices.list, its source',
      ),
    ])
  })
  it('says every reason it holds a list for, and wants each list it holds read', () => {
    const contract = withDevices()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.sessions.list': { kind: 'list', source: { platform: 'sessions.list' } },
    })
    contract.screens.platform.actions['sessions.list'] = {
      description: 'Lists the sessions.',
      params: {},
      result: 'the sessions',
      codes: ['failed'],
      changes: [],
    }
    Object.assign(contract.screens.platform.actions['devices.revoke'] ?? {}, {
      changes: ['devices.list', 'sessions.list'],
    })

    expect(printed(contract)).toEqual([
      unread(
        'states.revoking.invoke.onDone',
        'sample.sessions.list',
        'platform.devices.revoke',
        'the action changes sessions.list, its source',
      ),
    ])

    invokeIn(contract, 'revoking').onDone = { target: 'editing' }

    expect(printed(contract)).toEqual([
      unread(
        'states.revoking.invoke.onDone',
        DEVICES,
        'platform.devices.revoke',
        'the input device takes "sample.devices.device-item", an entry of it, and the action changes devices.list, its source',
      ),
      unread(
        'states.revoking.invoke.onDone',
        'sample.sessions.list',
        'platform.devices.revoke',
        'the action changes sessions.list, its source',
      ),
    ])
  })
  it('wants each branch of the onDone to read it, or to say read: false', () => {
    const contract = withDevices()
    const saving = invokeIn(contract, 'saving')

    modelActionIn(contract, 'updateThing').changes = ['devices.list']
    saving.onDone = [
      { target: 'editing', guard: 'titleGiven', actions: [read(DEVICES)] },
      { target: 'editing' },
    ]

    expect(printed(contract)).toEqual([
      unread(
        'states.saving.invoke.onDone[1]',
        DEVICES,
        'thing.updateThing',
        'the action changes devices.list, its source',
      ),
    ])

    saving.onDone = [
      { target: 'editing', guard: 'titleGiven', actions: [read(DEVICES)] },
      { target: 'editing', read: false },
    ]

    expect(printed(contract)).toEqual([])
  })
  it('holds nothing after an invoke that says read: false, nor after a failure', () => {
    const contract = withDevices()
    const revoking = invokeIn(contract, 'revoking')

    revoking.onDone = { target: 'editing' }
    revoking.onError = { target: 'editing' }

    expect(printed(contract)).toHaveLength(1)

    Object.assign(revoking, { read: false })

    expect(printed(contract)).toEqual([])
  })
  it('never holds a list whose source is an entity of the model, nor one of another screen', () => {
    const contract = withDevices()

    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.devices-list': { kind: 'list', source: { platform: 'devices.list' } },
    })
    modelActionIn(contract, 'updateThing').changes = ['devices.list']
    invokeIn(contract, 'saving').input = { id: 'sample.thing-item', title: 'sample.title-input' }

    expect(printed(contract)).toEqual([
      unread(
        'states.saving.invoke.onDone',
        DEVICES,
        'thing.updateThing',
        'the action changes devices.list, its source',
      ),
    ])
  })
})

/** The sample screen and the platform of the package's fixture, changed and loaded as the check loads them. */
function loadedWith(
  sample: (screen: Record<string, unknown>) => void,
  platform: (actions: Record<string, unknown>) => void,
): Contract {
  const fixtures = join(import.meta.dirname, '../../__fixtures__')
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-held-reads-'))
  const edit = (file: string, change: (value: Record<string, unknown>) => void): void => {
    const value = parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>

    change(value)
    writeFileSync(join(root, file), stringify(value))
  }

  try {
    cpSync(join(fixtures, CONTRACT_DIR), join(root, CONTRACT_DIR), { recursive: true })
    cpSync(join(fixtures, 'vocabulary.md'), join(root, VOCABULARY_FILE))
    cpSync(join(fixtures, 'model.schema.json'), join(root, MODEL_FILE))
    cpSync(join(fixtures, SCENARIOS_DIR), join(root, SCENARIOS_DIR), { recursive: true })
    edit(PLATFORM_FILE, (file) => platform(file['actions'] as Record<string, unknown>))
    edit('contract/domain/screens/sample/$key.yaml', sample)

    return contractAt(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('flowProblems and the reads a region written by its button holds', () => {
  /** The sample whose devices' revoke button has a region of its own, written `revoke`. */
  const revoking = (revoke: Record<string, unknown>): Contract =>
    loadedWith(
      (screen) => {
        const { 'sample.sign-out-button': _signOut, ...anchors } = screen['anchors'] as Record<
          string,
          unknown
        >
        const { states } = screen['flow'] as { states: Record<string, unknown> }

        screen['anchors'] = {
          ...anchors,
          [DEVICES]: { kind: 'list', source: { platform: 'devices.list' } },
          'sample.devices.device-item': { kind: 'item', dataId: 'the device' },
          'sample.devices.revoke-button': {
            kind: 'button',
            binding: {
              action: 'platform.devices.revoke',
              params: { device: 'sample.devices.device-item' },
            },
          },
        }
        screen['flow'] = {
          initial: 'viewing',
          states: {
            viewing: {
              type: 'parallel',
              states: { form: { initial: 'editing', states }, revoke },
            },
          },
        }
      },
      (actions) => {
        actions['devices.list'] = {
          description: 'Lists the devices.',
          params: {},
          result: 'the devices',
          codes: [],
          changes: [],
        }
        actions['devices.revoke'] = {
          description: 'Signs a device out.',
          params: { device: { type: 'string', description: 'The device.' } },
          result: 'the device is signed out',
          codes: [],
          changes: ['devices.list'],
        }
      },
    )

  it('holds the list its button changes, as an invoke holds it', () => {
    expect(printed(revoking({ by: 'sample.devices.revoke-button' }))).toEqual([
      unread(
        'states.viewing.states.revoke.states.running.invoke.onDone',
        DEVICES,
        'platform.devices.revoke',
        'the input device takes "sample.devices.device-item", an entry of it, and the action changes devices.list, its source',
      ),
    ])
    expect(
      printed(
        revoking({ by: 'sample.devices.revoke-button', onDone: { actions: [{ read: DEVICES }] } }),
      ),
    ).toEqual([])
    expect(printed(revoking({ by: 'sample.devices.revoke-button', read: false }))).toEqual([])
  })
})
