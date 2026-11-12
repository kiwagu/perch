import { describe, expect, it } from 'vitest'

import { screenFileSchema } from '../../schemas'
import type { Platform, Screen } from '../screens'

import { withDerivedLeaves, withoutWrittenLeaves } from './leaves'

type Policy = NonNullable<Platform['unsavedInput']>

const DIALOG = 'app-shell.leave-dialog'
const POLICY: Policy = {
  question: DIALOG,
  screen: 'question',
  actions: 'question',
  unload: 'browser',
  state: 'never',
  flow: 'never',
  elsewhere: 'cannot',
}
const FILE = 'contract/domain/screens/sample.yaml'

const EMAIL = 'sample.email-input'
const PASSWORD = 'sample.password-input'
const LANGUAGE = 'sample.language-select'
const LINK = 'sample.forgot-link'

/** A screen at `/sample` whose fields are an email, a password and a select applying at once. */
function screenWith(flow: unknown, anchors: Record<string, unknown> = {}): Screen {
  return screenFileSchema.parse({
    id: 'sample',
    title: 'Sample',
    description: 'A sample screen.',
    flag: null,
    bindings: [{ path: '/sample', roles: ['member'] }],
    entry: ['sample.page'],
    anchors: {
      'sample.page': { kind: 'page' },
      [EMAIL]: { kind: 'input', holdsInput: true },
      [PASSWORD]: { kind: 'input', secret: true, holdsInput: true },
      [LANGUAGE]: { kind: 'select', holdsInput: false },
      [LINK]: { kind: 'link' },
      ...anchors,
    },
    ...(flow === undefined ? {} : { flow }),
  })
}

/** A flow of one state whose `event` moves with `actions`. */
const onEvent = (event: string, actions: unknown[]) => ({
  initial: 'editing',
  states: { editing: { on: { [event]: { target: 'editing', actions } } } },
})

const navigate = (to: string, search?: Record<string, unknown>) => ({
  type: 'navigate',
  params: search === undefined ? { to } : { to, search },
})

const leavesOf = (screen: Screen, anchor: string) => screen.anchors[anchor]?.leaves

describe('withDerivedLeaves', () => {
  it('makes a control whose event moves to another screen ask, losing the fields the move does not carry', () => {
    const screen = screenWith(
      onEvent(LINK, [navigate('/forgot-password', { email: { anchor: EMAIL } })]),
    )

    expect(leavesOf(withDerivedLeaves(screen, POLICY), LINK)).toEqual({
      dialog: DIALOG,
      loses: [PASSWORD],
    })
  })

  it('loses every field that holds input when the move carries none, in order', () => {
    const screen = screenWith(onEvent(LINK, [navigate('/forgot-password')]))

    expect(leavesOf(withDerivedLeaves(screen, POLICY), LINK)?.loses).toEqual([EMAIL, PASSWORD])
  })

  it('asks nothing when the move carries every field that holds input', () => {
    const screen = screenWith(onEvent(LINK, [navigate('/elsewhere')]), {
      [PASSWORD]: { kind: 'input', holdsInput: false },
      [EMAIL]: { kind: 'input', holdsInput: false },
    })

    expect(leavesOf(withDerivedLeaves(screen, POLICY), LINK)).toBeUndefined()
  })

  it('asks nothing for a move to the path of its own screen: a change of state inside it', () => {
    const screen = screenWith(onEvent(LINK, [navigate('/sample', { q: { anchor: EMAIL } })]))

    expect(leavesOf(withDerivedLeaves(screen, POLICY), LINK)).toBeUndefined()
  })

  it('does not count the control that moves among what it loses', () => {
    const screen = screenWith(onEvent(EMAIL, [navigate('/elsewhere')]))

    expect(leavesOf(withDerivedLeaves(screen, POLICY), EMAIL)?.loses).toEqual([PASSWORD])
  })

  it('asks nothing for a move after an action or on a platform event', () => {
    const screen = screenWith({
      initial: 'editing',
      states: {
        editing: {
          on: {
            [LINK]: { target: 'sending' },
            'platform.signed-out': { target: 'editing', actions: [navigate('/sign-in')] },
          },
        },
        sending: {
          invoke: {
            src: 'platform.sign-out',
            onDone: { target: 'editing', actions: [navigate('/sign-in')] },
            onError: { target: 'editing', actions: [navigate('/sign-in')] },
          },
        },
      },
    })
    const derived = withDerivedLeaves(screen, POLICY)

    expect(Object.values(derived.anchors).map((def) => def.leaves)).toEqual(
      Object.values(screen.anchors).map(() => undefined),
    )
  })

  it('finds a move on a control handled in a region of a parallel state', () => {
    const screen = screenWith({
      initial: 'viewing',
      states: {
        viewing: {
          type: 'parallel',
          states: {
            help: {
              initial: 'idle',
              states: {
                idle: { on: { [LINK]: { target: 'idle', actions: [navigate('/help')] } } },
              },
            },
            other: { initial: 'idle', states: { idle: {} } },
          },
        },
      },
    })

    expect(leavesOf(withDerivedLeaves(screen, POLICY), LINK)?.loses).toEqual([EMAIL, PASSWORD])
  })

  it('asks nothing when a change of screen never asks, or the platform declares no policy', () => {
    const screen = screenWith(onEvent(LINK, [navigate('/forgot-password')]))

    expect(
      leavesOf(withDerivedLeaves(screen, { ...POLICY, screen: 'never' }), LINK),
    ).toBeUndefined()
    expect(leavesOf(withDerivedLeaves(screen, undefined), LINK)).toBeUndefined()
  })

  it('leaves a screen without a flow as it is', () => {
    const screen = screenWith(undefined)

    expect(withDerivedLeaves(screen, POLICY)).toEqual(screen)
  })
})

describe('withoutWrittenLeaves', () => {
  it('refuses a leave question a screen file writes and takes it away', () => {
    const written = { kind: 'link', leaves: { dialog: DIALOG, loses: [PASSWORD] } }
    const { value, problems } = withoutWrittenLeaves(FILE, {
      id: 'sample',
      anchors: { [LINK]: written },
    })

    expect(value).toEqual({ id: 'sample', anchors: { [LINK]: { kind: 'link' } } })
    expect(problems).toEqual([
      {
        file: FILE,
        message: `anchors["${LINK}"].leaves: leaves is derived from the control's flow: a screen file never writes it`,
      },
    ])
  })

  it('leaves a screen that writes none as it is', () => {
    const read = { id: 'sample', anchors: { [LINK]: { kind: 'link' } } }

    expect(withoutWrittenLeaves(FILE, read)).toEqual({ value: read, problems: [] })
  })
})
