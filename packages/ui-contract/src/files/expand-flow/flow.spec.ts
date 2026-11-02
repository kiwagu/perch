import { describe, expect, it } from 'vitest'

import { flowSchema } from '../../schemas'
import type { Failure } from '../derive'

import { expandFlow, type FlowLookups } from '.'

const CODES: Readonly<Record<string, readonly string[]>> = {
  'sample.form.error': ['required', 'taken', 'failed'],
  'sample.page.status': [],
}

const FAILURES: Readonly<Record<string, Failure>> = {
  'thing.save': { codes: ['taken', 'failed'], params: {} },
  'platform.things.open': { codes: [], params: {} },
}

const LOOKUPS: FlowLookups = {
  codesOf: (anchor) => CODES[anchor],
  failureOf: (action) => FAILURES[action],
  controls: [],
  screen: 'sample',
  toast: undefined,
  platformToasts: {},
}

/** A flow of one plain state `idle` whose transition on `sample.form.save-button` is `on`. */
const onSave = (on: unknown) => ({
  initial: 'idle',
  states: { idle: { on: { 'sample.form.save-button': on } }, saving: {} },
})

/** The transition `expandFlow` makes of `on`, with the issues. */
function expandedOn(on: unknown) {
  const { flow, issues } = expandFlow(onSave(on), LOOKUPS)
  const states = (flow as { states: { idle: { on: Record<string, unknown> } } }).states

  return { transition: states.idle.on['sample.form.save-button'], issues }
}

/** A parallel state `viewing` with the region `form` written as `region` and a second one. */
const withRegion = (region: unknown) => ({
  initial: 'viewing',
  states: {
    viewing: {
      type: 'parallel',
      states: { form: region, other: { initial: 'idle', states: { idle: {} } } },
    },
  },
})

/** The region `form` `expandFlow` makes of `region`, with the issues. */
function expandedRegion(region: unknown) {
  const { flow, issues } = expandFlow(withRegion(region), LOOKUPS)
  const viewing = (flow as { states: { viewing: { states: Record<string, unknown> } } }).states
    .viewing

  return { region: viewing.states['form'], issues }
}

describe('expandFlow', () => {
  it('leaves a canonical flow as it is', () => {
    const flow = onSave([
      { target: 'saving', guard: 'changed' },
      {
        actions: [{ type: 'show', params: { anchor: 'sample.form.error', codes: ['required'] } }],
      },
    ])

    expect(expandFlow(flow, LOOKUPS)).toEqual({ flow, issues: [], toasts: [], writtenToasts: [] })
  })

  it('turns a transition written as its target into the transition', () => {
    expect(expandedOn('saving')).toEqual({ transition: { target: 'saving' }, issues: [] })
    expect(expandedOn([{ target: 'saving', guard: 'changed' }, 'idle'])).toEqual({
      transition: [{ target: 'saving', guard: 'changed' }, { target: 'idle' }],
      issues: [],
    })
  })

  it('shows every code the anchor declares, in its order, for show: <anchor>', () => {
    expect(expandedOn({ actions: [{ show: 'sample.form.error' }] })).toEqual({
      transition: {
        actions: [
          {
            type: 'show',
            params: { anchor: 'sample.form.error', codes: ['required', 'taken', 'failed'] },
          },
        ],
      },
      issues: [],
    })
  })

  it('shows the codes named for show: { <anchor>: [codes] }', () => {
    expect(expandedOn({ actions: [{ show: { 'sample.form.error': ['taken'] } }] })).toEqual({
      transition: {
        actions: [{ type: 'show', params: { anchor: 'sample.form.error', codes: ['taken'] } }],
      },
      issues: [],
    })
  })

  it('writes clear and navigate by their names in full', () => {
    expect(
      expandedOn({
        target: 'saving',
        actions: [
          { clear: 'sample.form.error' },
          { navigate: '/me' },
          { navigate: { to: '/org', search: { view: 'read' } } },
        ],
      }).transition,
    ).toEqual({
      target: 'saving',
      actions: [
        { type: 'clear', params: { anchor: 'sample.form.error' } },
        { type: 'navigate', params: { to: '/me' } },
        { type: 'navigate', params: { to: '/org', search: { view: 'read' } } },
      ],
    })
  })

  it('names an anchor no screen declares, or one that declares no codes, for show: <anchor>', () => {
    expect(expandedOn({ actions: [{ show: 'sample.form.nothing' }] }).issues).toEqual([
      {
        at: ['flow', 'states', 'idle', 'on', 'sample.form.save-button', 'actions', 0, 'show'],
        message: 'no screen declares the anchor sample.form.nothing',
      },
    ])
    expect(expandedOn({ actions: [{ show: 'sample.page.status' }] }).issues).toEqual([
      {
        at: ['flow', 'states', 'idle', 'on', 'sample.form.save-button', 'actions', 0, 'show'],
        message:
          'the anchor sample.page.status declares no codes; name the ones it shows here: show: { sample.page.status: [<code>] }',
      },
    ])
  })

  it('expands the effects of entry, exit and an invoke, in a state of the root', () => {
    const { flow } = expandFlow(
      {
        initial: 'saving',
        states: {
          saving: {
            entry: [{ clear: 'sample.form.error' }],
            exit: [{ navigate: '/me' }],
            invoke: {
              src: 'thing.save',
              onDone: 'done',
              onError: { target: 'done', actions: [{ show: 'sample.form.error' }] },
            },
          },
          done: { type: 'final' },
        },
      },
      LOOKUPS,
    )

    expect(flow).toEqual({
      initial: 'saving',
      states: {
        saving: {
          entry: [{ type: 'clear', params: { anchor: 'sample.form.error' } }],
          exit: [{ type: 'navigate', params: { to: '/me' } }],
          invoke: {
            src: 'thing.save',
            onDone: { target: 'done' },
            onError: {
              target: 'done',
              actions: [
                {
                  type: 'show',
                  params: { anchor: 'sample.form.error', codes: ['taken', 'failed'] },
                },
              ],
            },
          },
        },
        done: { type: 'final' },
      },
    })
  })

  it('shows the codes the failure of the action shows for show: <anchor> in an onError', () => {
    const failing = (src: string) =>
      expandFlow(
        {
          initial: 'saving',
          states: {
            saving: {
              invoke: {
                src,
                onDone: 'saving',
                onError: [
                  { guard: 'left', target: 'saving' },
                  { target: 'saving', actions: [{ show: 'sample.form.error' }] },
                ],
              },
            },
          },
        },
        LOOKUPS,
      )

    expect(failing('thing.save').flow).toMatchObject({
      states: {
        saving: {
          invoke: {
            onError: [
              { guard: 'left', target: 'saving' },
              {
                target: 'saving',
                actions: [
                  {
                    type: 'show',
                    params: { anchor: 'sample.form.error', codes: ['taken', 'failed'] },
                  },
                ],
              },
            ],
          },
        },
      },
    })
    expect(failing('thing.nothing').issues.map(({ message }) => message)).toEqual([
      'thing.nothing is no action of the model or the platform, so the codes its failure shows are unknown; name the ones it shows here: show: { sample.form.error: [<code>] }',
    ])
    expect(failing('platform.things.open').issues.map(({ message }) => message)).toEqual([
      'platform.things.open fails with no code; name the ones it shows here: show: { sample.form.error: [<code>] }',
    ])
  })

  it('expands the shorter forms inside a region written in full', () => {
    expect(
      expandedRegion({
        initial: 'idle',
        states: { idle: { on: { 'sample.form.save-button': 'saving' } }, saving: {} },
      }).region,
    ).toEqual({
      initial: 'idle',
      states: { idle: { on: { 'sample.form.save-button': { target: 'saving' } } }, saving: {} },
    })
  })

  it('expands draft into following and edited, back to following whenever its guard holds', () => {
    expect(
      expandedRegion({
        pattern: 'draft',
        description: 'The name.',
        input: 'sample.form.name-input',
        stored: 'model.thing.name',
        guard: 'nameIsStored',
      }),
    ).toEqual({
      region: {
        description: 'The name.',
        initial: 'following',
        states: {
          following: { on: { 'sample.form.name-input': { target: 'edited' } } },
          edited: {
            on: {
              'sample.form.name-input': { target: 'following', guard: 'nameIsStored' },
              'model.thing.name': { target: 'following', guard: 'nameIsStored' },
            },
          },
        },
      },
      issues: [],
    })
  })

  it('names what is wrong in a pattern, and keeps the region as written', () => {
    const wrong = {
      pattern: 'draft',
      input: 'sample.form.name-input',
      stored: 'model.thing.name',
      at: 1,
    }
    const { region, issues } = expandedRegion(wrong)

    expect(region).toBe(wrong)
    expect(issues.map(({ at }) => at.join('.'))).toEqual(
      expect.arrayContaining([
        'flow.states.viewing.states.form.guard',
        'flow.states.viewing.states.form',
      ]),
    )
  })

  it('names a pattern it does not know', () => {
    expect(expandedRegion({ pattern: 'wizard', initial: 'one' }).issues).toEqual([
      {
        at: ['flow', 'states', 'viewing', 'states', 'form', 'pattern'],
        message: '"wizard" is not a region pattern: draft',
      },
    ])
  })

  it('makes a flow the canonical schema takes', () => {
    const { flow } = expandFlow(
      withRegion({
        pattern: 'draft',
        input: 'sample.form.name-input',
        stored: 'model.thing.name',
        guard: 'nameIsStored',
      }),
      LOOKUPS,
    )

    expect(flowSchema.safeParse(flow).success).toBe(true)
  })
})

describe('the request pattern', () => {
  const request = (states: Record<string, unknown>) =>
    expandFlow({ initial: 'idle', states }, LOOKUPS)

  it('gives an invoke without onError the clear on entry and the failure shown on the way back', () => {
    const { flow, issues } = request({
      idle: { on: { 'sample.form.save-button': 'saving' } },
      saving: { invoke: { src: 'thing.save', onDone: 'idle' } },
    })

    expect(issues).toEqual([])
    expect((flow as { states: Record<string, unknown> }).states['saving']).toEqual({
      entry: [{ type: 'clear', params: { anchor: 'sample.form.error' } }],
      invoke: {
        src: 'thing.save',
        onDone: { target: 'idle' },
        onError: {
          target: 'idle',
          actions: [
            { type: 'show', params: { anchor: 'sample.form.error', codes: ['taken', 'failed'] } },
          ],
        },
      },
    })
  })

  it('keeps a written entry, adding the clear first unless it clears the error already', () => {
    const states = (entry: unknown) => ({
      idle: { on: { 'sample.form.save-button': 'saving' } },
      saving: { entry, invoke: { src: 'thing.save', onDone: 'idle' } },
    })
    const entryOf = (entry: unknown) =>
      (request(states(entry)).flow as { states: { saving: { entry: unknown } } }).states.saving
        .entry

    expect(entryOf([{ clear: 'sample.page.status' }])).toEqual([
      { type: 'clear', params: { anchor: 'sample.form.error' } },
      { type: 'clear', params: { anchor: 'sample.page.status' } },
    ])
    expect(entryOf([{ clear: 'sample.form.error' }])).toEqual([
      { type: 'clear', params: { anchor: 'sample.form.error' } },
    ])
  })

  it('adds the default show to an onError written as its target alone, and nothing to one with actions', () => {
    const states = (onError: unknown) => ({
      idle: { on: { 'sample.form.save-button': 'saving' } },
      saving: { invoke: { src: 'thing.save', onDone: 'idle', onError } },
    })
    const onErrorOf = (onError: unknown) =>
      (request(states(onError)).flow as { states: { saving: { invoke: { onError: unknown } } } })
        .states.saving.invoke.onError
    const show = {
      type: 'show',
      params: { anchor: 'sample.form.error', codes: ['taken', 'failed'] },
    }

    expect(onErrorOf('idle')).toEqual({ target: 'idle', actions: [show] })
    expect(onErrorOf({ target: 'idle', description: 'Back.' })).toEqual({
      target: 'idle',
      description: 'Back.',
      actions: [show],
    })
    expect(onErrorOf({ target: 'idle', actions: [{ clear: 'sample.page.status' }] })).toEqual({
      target: 'idle',
      actions: [{ type: 'clear', params: { anchor: 'sample.page.status' } }],
    })
    expect(onErrorOf([{ target: 'idle', guard: 'changed' }, 'idle'])).toEqual([
      { target: 'idle', guard: 'changed' },
      { target: 'idle' },
    ])
  })

  it('adds nothing for an action that fails with no code, and no entry clear either', () => {
    const { flow, issues } = request({
      idle: { on: { 'sample.form.save-button': 'opening' } },
      opening: { invoke: { src: 'platform.things.open', onDone: 'idle' } },
    })

    expect(issues).toEqual([])
    expect((flow as { states: Record<string, unknown> }).states['opening']).toEqual({
      invoke: { src: 'platform.things.open', onDone: { target: 'idle' } },
    })
  })

  it('reports a state with codes to show and no single way back, at its invoke', () => {
    const { issues } = request({
      idle: { on: { 'sample.form.save-button': 'saving' } },
      saved: { on: { 'sample.form.save-button': 'saving' } },
      saving: { invoke: { src: 'thing.save', onDone: 'saved' } },
    })

    expect(issues).toEqual([
      {
        at: ['flow', 'states', 'saving', 'invoke', 'onError'],
        message:
          'thing.save fails with taken, failed and the state writes no onError: saving is entered from idle and saved: no single way back; write its onError',
      },
    ])
  })

  /** The states `expandFlow` makes of `states` starting in `initial`, with the issues. */
  const startingIn = (initial: string, states: Record<string, unknown>) => {
    const { flow, issues } = expandFlow({ initial, states }, LOOKUPS)

    return { states: (flow as { states: Record<string, unknown> }).states, issues }
  }
  const SHOW = {
    type: 'show',
    params: { anchor: 'sample.form.error', codes: ['taken', 'failed'] },
  }
  /** `invoke` with `onError` when one is given. */
  const invoking = (invoke: Record<string, unknown>, onError?: unknown) =>
    onError === undefined ? { invoke } : { invoke: { ...invoke, onError } }

  it('reports an initial request a sibling retries into, and shows on its bare onError', () => {
    const retried = (onError?: unknown) =>
      startingIn('saving', {
        saving: invoking({ src: 'thing.save', onDone: 'done' }, onError),
        failed: { on: { 'sample.form.retry-button': 'saving' } },
        done: { type: 'final' },
      })

    const unwritten = retried()
    const bare = retried('failed')

    expect(unwritten.issues).toEqual([
      {
        at: ['flow', 'states', 'saving', 'invoke', 'onError'],
        message:
          'thing.save fails with taken, failed and the state writes no onError: saving is where its area starts, so it has no single way back; write its onError',
      },
    ])
    expect(unwritten.states['saving']).toEqual({
      invoke: { src: 'thing.save', onDone: { target: 'done' } },
    })
    expect(bare.issues).toEqual([])
    expect(bare.states['saving']).toEqual({
      invoke: {
        src: 'thing.save',
        onDone: { target: 'done' },
        onError: { target: 'failed', actions: [SHOW] },
      },
    })
  })

  it('reports an initial request of a region a sibling retries into, and shows on its bare onError', () => {
    const retried = (onError?: unknown) =>
      expandedRegion({
        initial: 'saving',
        states: {
          saving: invoking({ src: 'thing.save', onDone: 'idle' }, onError),
          failed: { on: { 'sample.form.retry-button': 'saving' } },
          idle: {},
        },
      })

    expect(retried().issues).toEqual([
      {
        at: [
          'flow',
          'states',
          'viewing',
          'states',
          'form',
          'states',
          'saving',
          'invoke',
          'onError',
        ],
        message:
          'thing.save fails with taken, failed and the state writes no onError: saving is where its area starts, so it has no single way back; write its onError',
      },
    ])
    expect(retried().region).toMatchObject({
      states: { saving: { invoke: { src: 'thing.save', onDone: { target: 'idle' } } } },
    })
    expect(retried().region).not.toHaveProperty(['states', 'saving', 'invoke', 'onError'])
    expect(retried().region).not.toHaveProperty(['states', 'saving', 'entry'])
    expect(retried('failed')).toEqual({
      region: {
        initial: 'saving',
        states: {
          saving: {
            invoke: {
              src: 'thing.save',
              onDone: { target: 'idle' },
              onError: { target: 'failed', actions: [SHOW] },
            },
          },
          failed: { on: { 'sample.form.retry-button': { target: 'saving' } } },
          idle: {},
        },
      },
      issues: [],
    })
  })

  it('shows on the bare onError of an initial request by the part of its input fields', () => {
    const { states, issues } = startingIn('saving', {
      saving: invoking(
        { src: 'thing.save', input: { name: 'sample.form.name-input' }, onDone: 'idle' },
        'idle',
      ),
      idle: {},
    })

    expect(issues).toEqual([])
    expect(states['saving']).toEqual({
      invoke: {
        src: 'thing.save',
        input: { name: 'sample.form.name-input' },
        onDone: { target: 'idle' },
        onError: { target: 'idle', actions: [SHOW] },
      },
    })
  })

  it('shows on the bare onError of a request two states enter by controls of one part', () => {
    const { states, issues } = startingIn('idle', {
      idle: { on: { 'sample.form.save-button': 'saving' } },
      saved: { on: { 'sample.form.save-button': 'saving' } },
      saving: invoking({ src: 'thing.save', onDone: 'saved' }, 'idle'),
    })

    expect(issues).toEqual([])
    expect(states['saving']).toEqual({
      invoke: {
        src: 'thing.save',
        onDone: { target: 'saved' },
        onError: { target: 'idle', actions: [SHOW] },
      },
    })
  })

  it('reports a bare onError with no error to show on, and every reason a request lacks', () => {
    const bare = startingIn('idle', {
      idle: { on: { 'other.part.go-button': 'saving' } },
      saving: invoking({ src: 'thing.save', onDone: 'idle' }, 'idle'),
    })
    const neither = startingIn('saving', {
      saving: invoking({ src: 'thing.save', onDone: 'saving' }),
    })

    expect(bare.issues).toEqual([
      {
        at: ['flow', 'states', 'saving', 'invoke', 'onError'],
        message:
          'thing.save fails with taken, failed and its onError shows them nowhere: no other.part.error and no sample.error; write its show',
      },
    ])
    expect(bare.states['saving']).toEqual({
      invoke: { src: 'thing.save', onDone: { target: 'idle' }, onError: { target: 'idle' } },
    })
    expect(neither.issues.map(({ message }) => message)).toEqual([
      'thing.save fails with taken, failed and the state writes no onError: saving is where its area starts, so it has no single way back; no control enters saving and its input names no field: no part has its error; write its onError',
    ])
  })
})
