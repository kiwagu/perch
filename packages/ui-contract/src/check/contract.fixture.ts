/**
 * A small, consistent contract in memory for the specs of the check: every rule is green
 * on it, and a spec changes one thing and asserts the one problem that follows.
 */

import type { AnchorDef, Screen } from '../files'

import type { Contract } from './contract'

const meaning = (keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((key) => [key, `the ${key}`]))

const located = (keys: readonly string[], where: string) =>
  Object.fromEntries(keys.map((key) => [key, { where, meaning: `the ${key}` }]))

const SAMPLE_ANCHORS: Record<string, AnchorDef> = {
  'sample.page': { kind: 'page' },
  'sample.title-input': { kind: 'input', binding: { model: 'thing.title' } },
  'sample.save-button': {
    kind: 'button',
    binding: [
      { action: 'thing.createThing', params: { title: 'sample.title-input' } },
      { action: 'thing.updateThing', params: { id: 'sample.thing-item', title: { value: 'x' } } },
    ],
    roles: ['member'],
    codes: ['saved'],
  },
  'sample.list': {
    kind: 'list',
    source: { entity: 'thing', order: 'created_at', direction: 'asc' },
    states: ['loading'],
  },
  'sample.thing-item': { kind: 'item', dataId: 'thing', states: ['current'] },
  'sample.mode-select': { kind: 'select', dataValue: true, derived: ['option'] },
  'sample.key-select': { kind: 'select', dataValue: true, derived: ['option'] },
  'sample.a-button': { kind: 'button' },
  'sample.b-button': { kind: 'button' },
  'sample.home-link': { kind: 'link', binding: { route: '/sample/$key' } },
  'sample.sign-out-button': {
    kind: 'button',
    binding: { action: 'platform.sign-out', params: { forgetUnsent: { value: true } } },
  },
  'sample.devices-list': { kind: 'list', source: { platform: 'devices.list' } },
}

const SAMPLE: Screen = {
  id: 'sample',
  title: 'One thing',
  bindings: [
    {
      path: '/sample/$key',
      roles: ['member'],
      history: 'push',
      params: {
        type: 'object',
        properties: { key: { type: 'string' } },
        additionalProperties: false,
      },
      search: {
        type: 'object',
        properties: {
          tab: {
            type: 'string',
            enum: ['a', 'b'],
            'x-perch': {
              control: 'sample.mode-select',
              values: { a: { control: 'sample.a-button' }, b: { control: 'sample.b-button' } },
            },
          },
        },
        additionalProperties: false,
      },
      retain: ['tab'],
    },
  ],
  flag: null,
  entry: ['sample.page'],
  anchors: SAMPLE_ANCHORS,
  flow: {
    states: ['editing'],
    initial: 'editing',
    events: [
      {
        on: 'sample.save-button',
        action: 'thing.updateThing',
        params: { title: 'sample.title-input' },
        outcomes: { success: { route: '/sample/$key' }, failure: { codes: ['failed'] } },
      },
    ],
  },
}

const APP_SHELL: Screen = {
  id: 'app-shell',
  title: 'Frame',
  frame: true,
  bindings: [],
  flag: null,
  entry: ['app-shell.status'],
  anchors: { 'app-shell.status': { kind: 'status', states: ['opening', 'ready'] } },
}

export function sampleContract(): Contract {
  return structuredClone({
    vocabulary: {
      version: 1,
      kinds: meaning(['button', 'link', 'input', 'list', 'item', 'select', 'page', 'status']),
      suffixes: meaning(['option', 'item', 'confirm-button']),
      attributes: {},
      appStates: meaning(['opening', 'ready']),
      containerStates: meaning(['loading', 'ready', 'empty']),
      rowStates: located(['current'], 'sample.thing-item'),
      codes: located(['saved', 'failed', 'devices-read-failed'], 'sample.save-button'),
      choiceValues: {
        'sample.mode-select.option': meaning(['a', 'b']),
        'sample.key-select.option': { '^k[0-9]+$': 'a key' },
      },
      screenNames: meaning(['app-shell', 'sample']),
      roles: meaning(['guest', 'member']),
      reserved: meaning(['app-shell.status']),
    },
    screens: {
      version: 1,
      screens: [APP_SHELL, SAMPLE],
      platform: {
        actions: {
          'sign-out': {
            description: 'Signs this device out.',
            params: { forgetUnsent: { type: 'boolean', description: 'Drop the unsent changes.' } },
            result: 'this device signs out',
            codes: ['failed'],
          },
          'devices.list': {
            description: 'Lists the devices.',
            params: {},
            result: 'the devices',
            codes: ['devices-read-failed'],
            roles: ['member'],
          },
        },
        reserved: ['app-shell.status'],
        status: { anchor: 'app-shell.status', states: ['opening', 'ready'] },
      },
    },
    scenarios: [
      {
        id: 'sample/base/thing',
        title: 'Edit the thing',
        tags: ['smoke'],
        devices: { A: 'member' },
        where: '[/sample/$key]',
        data: { Title: 'generate' },
        scenario: 'A member picks [value:a] in [sample.mode-select.option] and [value:k12]',
        steps: ['Wait for [app-shell.status] to reach [state:ready]'],
        expected: ['[sample.save-button] carries [code:saved]'],
      },
    ],
    model: {
      document: {},
      entities: {
        thing: {
          name: 'thing',
          table: 'thing',
          region: 'tenant',
          id: 'thg',
          actions: {
            createThing: { params: { id: '$id', title: 'title' } },
            updateThing: { params: { id: '$id', title: 'title' } },
          },
          unique: [],
          index: [],
          fields: {
            id: { type: 'string', readonly: true },
            title: { type: 'string', readonly: false, crdt: 'text' },
            created_at: { type: 'string', readonly: true },
          },
        },
      },
    },
  })
}

/** The screen `id` of a contract, for a spec to change. */
export function screenIn(contract: Contract, id: string): Screen {
  const screen = contract.screens.screens.find((candidate) => candidate.id === id)

  if (screen === undefined) {
    throw new Error(`no screen ${id}`)
  }

  return screen
}

/** The declared anchor `anchor` of the sample screen, for a spec to change. */
export function anchorIn(contract: Contract, anchor: string): AnchorDef {
  const def = screenIn(contract, 'sample').anchors[anchor]

  if (def === undefined) {
    throw new Error(`no anchor ${anchor}`)
  }

  return def
}
