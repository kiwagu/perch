import { describe, expect, it } from 'vitest'

import { screenFileSchema } from '../../schemas'
import type { Platform, Screen } from '../screens'

import type { LoadedScreen } from './link-roles'
import { withDerivedMailLinks } from './mail-links'

type Source = Parameters<typeof withDerivedMailLinks>[1]
type Action = Platform['actions'][string]
type Value = NonNullable<Platform['values']>[string]

const PLATFORM_FILE = 'contract/domain/platform.yaml'
const FILE = 'contract/domain/screens/landing.yaml'

/** The value the platform declares for the token a mail's link carries. */
const TOKEN: Value = {
  type: 'string',
  minLength: 1,
  maxLength: 4096,
  description: 'The token the link of a mail carries.',
  examples: ['token-0123456789abcdef'],
}

/** What a version-3 landing writes for the token, with the keys of the value and no key of an address. */
const WRITTEN = {
  type: 'string',
  minLength: 1,
  maxLength: 4096,
  description: 'The token the link of a mail carries.',
  examples: ['token-0123456789abcdef'],
}

const DERIVED = { ...WRITTEN, 'x-perch': { key: 'link-invalid' } }

const searchOf = (properties: Record<string, unknown>, required?: readonly string[]) => ({
  type: 'object',
  properties,
  ...(required === undefined ? {} : { required }),
  additionalProperties: false,
})

const action = (more: Partial<Action> = {}): Action => ({
  description: 'An action.',
  params: {},
  result: 'it is done',
  codes: ['failed'],
  changes: [],
  ...more,
})

/** An action that takes `token` into its parameter of the same name, which lists `codes`. */
const opening = (codes?: readonly string[]): Action =>
  action({
    params: {
      token: {
        value: 'token',
        ...(codes === undefined ? {} : { codes: [...codes] }),
        description: 'The token.',
      },
    },
    codes: ['link-invalid', 'link-expired', 'failed'],
  })

/** An action that sends the mail whose link opens `screen` with the search parameter `search`. */
const mailing = (screen: string, search = 'token'): Action =>
  action({
    params: { email: { type: 'string', description: 'The email.' } },
    mail: { to: 'email', language: 'account', link: { screen, search } },
  })

/** The platform: the token value, the action that takes it and the action that mails its link. */
const platformOf = (actions: Record<string, Action> = {}): Source => ({
  values: { token: TOKEN },
  actions: {
    open: opening(['link-invalid', 'link-expired']),
    invite: mailing('landing'),
    ...actions,
  },
})

/** The flow of a landing that opens with `src`, passing the token as `{ search: token }` into `param`. */
const opensWith = (src: string, param = 'token') => ({
  initial: 'opening',
  states: {
    opening: {
      invoke: {
        src,
        input: { [param]: { search: 'token' } },
        onDone: { target: 'done' },
        onError: { target: 'done' },
      },
    },
    done: { type: 'final' },
  },
})

interface Landing {
  readonly id?: string
  readonly bindings?: readonly unknown[]
  readonly flow?: unknown
  readonly anchors?: Record<string, unknown>
}

/** A screen at `/landing` (or the frame, with `bindings: []`) whose flow runs `platform.open` with the token. */
function landing({ id = 'landing', bindings, flow, anchors }: Landing = {}): Screen {
  return screenFileSchema.parse({
    id,
    title: `The ${id} screen`,
    description: `What the ${id} screen is for.`,
    ...(bindings?.length === 0 ? { frame: true } : {}),
    flag: null,
    bindings: bindings ?? [{ path: `/${id}`, roles: ['guest'] }],
    entry: [`${id}.page`],
    anchors: { [`${id}.page`]: { kind: 'page' }, ...anchors },
    flow: flow ?? opensWith('platform.open'),
  })
}

const readOf = (...screens: readonly Screen[]): LoadedScreen[] =>
  screens.map((screen) => ({
    file: `contract/domain/screens/${screen.id}.yaml`,
    screen,
  }))

/** The screens the derivation gives, in their order. */
const derive = (screens: readonly Screen[], platform: Source = platformOf(), edition = 4) =>
  withDerivedMailLinks(readOf(...screens), platform, edition)

const parameterOf = (screen: Screen | undefined, index = 0) =>
  screen?.bindings[index]?.search?.properties['token']

/** The token parameter of the one screen `derive` returns. */
const tokenOf = (...args: Parameters<typeof derive>) =>
  parameterOf(derive(...args).loaded[0]?.screen)

describe('withDerivedMailLinks', () => {
  it('gives the screen a mail links to the search parameter its platform value says, as a file would write it, with its key', () => {
    const bare = landing()
    const written = landing({
      bindings: [
        {
          path: '/landing',
          roles: ['guest'],
          search: searchOf({ token: WRITTEN }),
        },
      ],
    })
    const derived = derive([bare])

    expect(bare.bindings[0]?.search).toBeUndefined()
    expect(derived.problems).toEqual([])
    expect(derived.loaded[0]?.screen.bindings[0]?.search).toEqual(searchOf({ token: DERIVED }))
    expect(derived.loaded[0]?.screen.bindings[0]?.search?.properties['token']).toEqual({
      ...written.bindings[0]?.search?.properties['token'],
      'x-perch': { key: 'link-invalid' },
    })
    expect(derived.loaded[0]?.file).toBe(FILE)
  })
  it('carries the type, the enum, the bounds, the description and the primitive examples of the value', () => {
    const value: Value = {
      type: 'string',
      enum: ['a', 'b'],
      minLength: 1,
      maxLength: 5,
      pattern: '^[ab]+$',
      description: 'A letter.',
      examples: ['a', { not: 'primitive' }],
    }
    const whole: Value = {
      type: 'integer',
      minimum: 1,
      maximum: 9,
      description: 'A digit.',
    }

    expect(tokenOf([landing()], { ...platformOf(), values: { token: value } })).toEqual({
      type: 'string',
      enum: ['a', 'b'],
      minLength: 1,
      maxLength: 5,
      pattern: '^[ab]+$',
      description: 'A letter.',
      examples: ['a'],
      'x-perch': { key: 'link-invalid' },
    })
    expect(tokenOf([landing()], { ...platformOf(), values: { token: whole } })).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 9,
      description: 'A digit.',
      'x-perch': { key: 'link-invalid' },
    })
  })
  it('keeps the other search parameters of a route and what it requires, and adds the parameter last', () => {
    const tab = { type: 'string', enum: ['a', 'b'] }
    const [{ screen }] = derive([
      landing({
        bindings: [
          {
            path: '/landing',
            roles: ['guest'],
            search: searchOf({ tab }, ['tab']),
          },
        ],
      }),
    ]).loaded as [LoadedScreen]

    expect(screen.bindings[0]?.search).toEqual(searchOf({ tab, token: DERIVED }, ['tab']))
    expect(Object.keys(screen.bindings[0]?.search?.properties ?? {})).toEqual(['tab', 'token'])
  })
  it('gives every route of a screen with several the parameter, and leaves the others as they are', () => {
    const other = landing({ id: 'other' })
    const { loaded } = derive([
      landing({
        bindings: [
          { path: '/landing', roles: ['guest'] },
          { path: '/landing/again', roles: ['guest'], search: searchOf({}) },
        ],
      }),
      other,
    ])

    expect(parameterOf(loaded[0]?.screen, 0)).toEqual(DERIVED)
    expect(parameterOf(loaded[0]?.screen, 1)).toEqual(DERIVED)
    expect(loaded[1]?.screen).toBe(other)
  })
  it('leaves the frame, which has no route, and a screen no mail links to as they are', () => {
    const frame = landing({ id: 'landing', bindings: [] })
    const unnamed = landing({ id: 'elsewhere' })
    const platform = platformOf({ invite: mailing('landing') })
    const { loaded, problems } = derive([frame, unnamed], platform)

    expect(problems).toEqual([])
    expect(loaded.map(({ screen }) => screen)).toEqual([frame, unnamed])
    expect(loaded[0]?.screen).toBe(frame)
    expect(loaded[1]?.screen).toBe(unnamed)
  })
  it('derives the parameter once however many mails link to the screen with it', () => {
    const platform = platformOf({
      remind: mailing('landing'),
      resend: mailing('landing'),
    })
    const { loaded, problems } = derive([landing()], platform)

    expect(problems).toEqual([])
    expect(parameterOf(loaded[0]?.screen)).toEqual(DERIVED)
  })
  it('derives each parameter the mails of a screen name', () => {
    const platform: Source = {
      values: {
        token: TOKEN,
        ref: { ...TOKEN, description: 'A reference.', examples: ['r-1'] },
      },
      actions: {
        open: opening(['link-invalid']),
        invite: mailing('landing'),
        ask: mailing('landing', 'ref'),
      },
    }
    const properties = derive([landing()], platform).loaded[0]?.screen.bindings[0]?.search
      ?.properties

    expect(Object.keys(properties ?? {})).toEqual(['token', 'ref'])
    expect(properties?.['ref']).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 4096,
      description: 'A reference.',
      examples: ['r-1'],
    })
  })

  describe('the key', () => {
    it('is the first code the parameter lists, not the last or the one the action fails with first', () => {
      const platform = platformOf({
        open: opening(['link-expired', 'link-invalid']),
      })

      expect(tokenOf([landing()], platform)?.['x-perch']).toEqual({
        key: 'link-expired',
      })
    })
    it('is none when the parameter lists no codes', () => {
      expect(tokenOf([landing()], platformOf({ open: opening() }))).toEqual(WRITTEN)
    })
    it('is none when the first action that takes the parameter is an action of the model', () => {
      const screen = landing({ flow: opensWith('thing.updateThing', 'title') })

      expect(tokenOf([screen])).toEqual(WRITTEN)
    })
    it('is none when no action of the screen takes the parameter', () => {
      const screen = landing({
        flow: { initial: 'idle', states: { idle: { type: 'final' } } },
      })

      expect(tokenOf([screen])).toEqual(WRITTEN)
    })
    it('is none when the first action to take the parameter lists no codes, however another does', () => {
      const platform = platformOf({
        first: opening(),
        open: opening(['link-invalid']),
      })
      const flow = {
        initial: 'one',
        states: {
          one: {
            invoke: {
              src: 'platform.first',
              input: { token: { search: 'token' } },
              onDone: { target: 'two' },
            },
          },
          two: {
            invoke: {
              src: 'platform.open',
              input: { token: { search: 'token' } },
              onDone: { target: 'done' },
            },
          },
          done: { type: 'final' },
        },
      }

      expect(tokenOf([landing({ flow })], platform)).toEqual(WRITTEN)
    })
    it('comes from an invoke of the flow before a source of a list', () => {
      const platform = platformOf({
        read: {
          ...opening(['link-expired']),
          codes: ['link-expired', 'failed'],
        },
      })
      const sourced = {
        'landing.entries-list': {
          kind: 'list',
          source: { platform: 'read', params: { token: { search: 'token' } } },
        },
      }

      expect(tokenOf([landing({ anchors: sourced })], platform)?.['x-perch']).toEqual({
        key: 'link-invalid',
      })
    })
    it('comes from a source of a list when no invoke takes the parameter', () => {
      const sourced = {
        'landing.entries-list': {
          kind: 'list',
          source: { platform: 'open', params: { token: { search: 'token' } } },
        },
      }
      const flow = { initial: 'idle', states: { idle: { type: 'final' } } }

      expect(tokenOf([landing({ anchors: sourced, flow })])?.['x-perch']).toEqual({
        key: 'link-invalid',
      })
    })
  })

  describe('before version 4', () => {
    it('derives nothing and says nothing, whatever the mails and the files write', () => {
      const written = landing({
        bindings: [
          {
            path: '/landing',
            roles: ['guest'],
            search: searchOf({ token: WRITTEN }),
          },
        ],
      })
      const platform = platformOf({ ask: mailing('landing', 'unknown') })

      for (const edition of [1, 3]) {
        const { loaded, problems } = derive([landing(), written], platform, edition)

        expect(problems).toEqual([])
        expect(loaded[0]?.screen.bindings[0]?.search).toBeUndefined()
        expect(loaded[1]?.screen).toBe(written)
      }
    })
  })

  describe('refuses', () => {
    it('the parameter a file writes, at the route that writes it, and takes the derived one', () => {
      const written = landing({
        bindings: [
          { path: '/landing', roles: ['guest'] },
          {
            path: '/landing/again',
            roles: ['guest'],
            search: searchOf({
              token: { ...WRITTEN, description: 'Written by hand.' },
            }),
          },
        ],
      })
      const { loaded, problems } = derive([written])

      expect(problems).toEqual([
        {
          file: FILE,
          message:
            'bindings[1].search.properties.token: derived from the mail link of the platform action "invite"; leave it out',
        },
      ])
      expect(parameterOf(loaded[0]?.screen, 1)).toEqual(DERIVED)
    })
    it('a mail whose search names no value of the platform, at its link', () => {
      const platform: Source = {
        actions: { open: opening(), ask: mailing('landing', 'ticket') },
      }
      const screen = landing()
      const { loaded, problems } = derive([screen], platform)

      expect(problems).toEqual([
        {
          file: PLATFORM_FILE,
          message:
            'actions.ask.mail.link.search: "ticket" is no value of the platform, so the mail\'s link has no parameter to carry its token in',
        },
      ])
      expect(loaded[0]?.screen).toBe(screen)
    })
    it('a mail whose search names a value a route cannot take: one without a type, or with a format', () => {
      const platform: Source = {
        values: {
          typeless: { description: 'Either.', enum: ['a', 'b'] },
          email: { type: 'string', format: 'email', description: 'An email.' },
        },
        actions: {
          ask: mailing('landing', 'typeless'),
          tell: mailing('landing', 'email'),
        },
      }
      const { problems } = derive([landing()], platform)

      expect(problems).toEqual([
        {
          file: PLATFORM_FILE,
          message:
            'actions.ask.mail.link.search: "typeless" cannot be the search parameter of a route: it has no type',
        },
        {
          file: PLATFORM_FILE,
          message:
            'actions.tell.mail.link.search: "email" cannot be the search parameter of a route: it names a format, which a route never takes',
        },
      ])
    })
  })
})
