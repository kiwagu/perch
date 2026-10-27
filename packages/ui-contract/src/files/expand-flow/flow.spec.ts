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

    expect(expandFlow(flow, LOOKUPS)).toEqual({ flow, issues: [], toasts: [] })
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
