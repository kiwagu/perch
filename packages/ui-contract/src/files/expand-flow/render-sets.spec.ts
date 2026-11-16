import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import { flowSchema } from '../../schemas'
import { loadScreens } from '../screens'

import { withRenderSets } from './render-sets'
import { expandFlow, type FlowLookups } from '.'

const FORM = ['sample.form', 'sample.title-input', 'sample.save-button']

const AT = ['flow']

/** A flow whose states `asking` and `saving` render the anchors of a set, named. */
const named = (extra: Record<string, unknown> = {}) => ({
  initial: 'asking',
  meta: { renders: { form: FORM }, ...extra },
  states: {
    asking: { meta: { renders: ['form'] } },
    saving: { meta: { renders: ['form'] } },
    done: {},
  },
})

/** The same flow, its states writing the anchors out. */
const writtenOut = {
  initial: 'asking',
  states: {
    asking: { meta: { renders: FORM } },
    saving: { meta: { renders: FORM } },
    done: {},
  },
}

/** A flow whose root is a parallel state of two regions, `form` listing `renders` in `open` and `sending`. */
const inRegion = (renders: readonly string[]) => ({
  initial: 'viewing',
  meta: { renders: { form: FORM } },
  states: {
    viewing: {
      type: 'parallel',
      states: {
        form: {
          initial: 'open',
          states: { open: { meta: { renders } }, sending: { meta: { renders } } },
        },
        other: { initial: 'idle', states: { idle: {} } },
      },
    },
  },
})

const rendersOf = (flow: unknown, state: string): unknown =>
  (flow as { states: Record<string, { meta?: { renders?: unknown } }> }).states[state]?.meta
    ?.renders

describe('withRenderSets', () => {
  it('writes the anchors of a set into each state that lists it, as the states written out', () => {
    expect(withRenderSets(named(), AT)).toEqual({ flow: writtenOut, issues: [] })
  })

  it('lists no anchor of the set in the states as written', () => {
    const flow = named()

    for (const state of ['asking', 'saving']) {
      expect(rendersOf(flow, state)).toEqual(['form'])
      for (const anchor of FORM) {
        expect(rendersOf(flow, state)).not.toContain(anchor)
      }
    }
    expect(rendersOf(withRenderSets(flow, AT).flow, 'asking')).toEqual(FORM)
  })

  it('replaces the name in place, keeping the order and the anchors the state lists itself', () => {
    const flow = named()
    const asking = { meta: { renders: ['sample.list', 'form', 'sample.sign-out-button'] } }

    expect(
      rendersOf(withRenderSets({ ...flow, states: { ...flow.states, asking } }, AT).flow, 'asking'),
    ).toEqual(['sample.list', ...FORM, 'sample.sign-out-button'])
  })

  it('expands a set listed by the states of a region', () => {
    const { flow, issues } = withRenderSets(inRegion(['form']), AT)
    const form = (
      flow as {
        states: { viewing: { states: Record<string, { states: Record<string, unknown> }> } }
      }
    ).states.viewing.states['form']

    expect(issues).toEqual([])
    expect(form?.states).toEqual({
      open: { meta: { renders: FORM } },
      sending: { meta: { renders: FORM } },
    })
  })

  it('leaves no map of sets in the flow, and the guards beside it', () => {
    const guards = { changed: 'what was typed is not the stored value' }
    const { flow } = withRenderSets(named({ guards }), AT)

    expect(flow['meta']).toEqual({ guards })
    expect('meta' in withRenderSets(named(), AT).flow).toBe(false)
  })

  it('returns the very flow it is given when it writes no map and lists no name', () => {
    const { flow, issues } = withRenderSets(writtenOut, AT)

    expect(flow).toBe(writtenOut)
    expect(issues).toEqual([])
  })

  it('counts a state once, however often it lists the set', () => {
    const flow = {
      ...named(),
      states: { asking: { meta: { renders: ['form', 'form'] } }, saving: {} },
    }

    expect(withRenderSets(flow, AT).issues).toEqual([
      {
        at: ['flow', 'meta', 'renders', 'form'],
        message:
          'the set "form" is listed by one state: a set is for two states or more, list its anchors where a state renders them',
      },
    ])
  })

  describe('refuses', () => {
    it('a name that names no set, at the state that lists it', () => {
      const flow = named()
      const states = { ...flow.states, done: { meta: { renders: ['forms'] } } }

      expect(withRenderSets({ ...flow, states }, AT).issues).toEqual([
        {
          at: ['flow', 'states', 'done', 'meta', 'renders'],
          message: '"forms" names no set of flow.meta.renders',
        },
      ])
    })

    it('a name in a flow that declares no set, in a region too', () => {
      const flow = inRegion(['form'])
      const { meta: _sets, ...bare } = flow

      expect(withRenderSets(bare, ['screen', 'flow']).issues).toEqual([
        {
          at: [
            'screen',
            'flow',
            'states',
            'viewing',
            'states',
            'form',
            'states',
            'open',
            'meta',
            'renders',
          ],
          message: '"form" names no set of flow.meta.renders',
        },
        {
          at: [
            'screen',
            'flow',
            'states',
            'viewing',
            'states',
            'form',
            'states',
            'sending',
            'meta',
            'renders',
          ],
          message: '"form" names no set of flow.meta.renders',
        },
      ])
    })

    it('a set that one state lists, and one that no state lists', () => {
      const flow = named()
      const one = { ...flow, states: { ...flow.states, saving: {} } }
      const none = { ...flow, states: { asking: {}, saving: {} } }

      expect(withRenderSets(one, AT).issues.map((issue) => issue.message)).toEqual([
        'the set "form" is listed by one state: a set is for two states or more, list its anchors where a state renders them',
      ])
      expect(withRenderSets(none, AT).issues).toEqual([
        {
          at: ['flow', 'meta', 'renders', 'form'],
          message:
            'the set "form" is listed by no state: a set is for two states or more, list its anchors where a state renders them',
        },
      ])
    })

    it.each([
      ['a map that is no map', ['sample.form'], []],
      ['a set that is no list', { form: 'sample.form' }, ['form']],
      ['a set with no anchor', { form: [] }, ['form']],
      ['a set that lists what is no anchor', { form: ['Sample Form'] }, ['form', 0]],
      ['a set named with a dot', { 'sample.form': FORM }, ['sample.form']],
    ])('%s', (_what, sets, path) => {
      const flow = { ...named(), meta: { renders: sets } }
      const { issues } = withRenderSets(flow, AT)

      expect(issues.map((issue) => issue.at)).toContainEqual(['flow', 'meta', 'renders', ...path])
    })
  })
})

describe('expandFlow with sets', () => {
  const lookups: FlowLookups = {
    codesOf: () => undefined,
    failureOf: () => undefined,
    controls: [],
    screen: 'sample',
    toast: undefined,
    platformToasts: {},
  }

  it('expands the flow into the one written out, which the canonical schema takes', () => {
    const expanded = expandFlow(named(), lookups)

    expect(expanded.issues).toEqual([])
    expect(expanded.flow).toEqual(expandFlow(writtenOut, lookups).flow)
    expect(flowSchema.safeParse(expanded.flow).success).toBe(true)
  })

  it('reports the sets beside what else keeps the flow from expanding', () => {
    const flow = named()
    const states = {
      ...flow.states,
      done: { meta: { renders: ['forms'] }, entry: [{ show: 'sample.nothing' }] },
    }
    const { issues } = expandFlow({ ...flow, states }, lookups)

    expect(issues.map((issue) => issue.at.join('.'))).toEqual([
      'flow.states.done.meta.renders',
      'flow.states.done.entry.0.show',
    ])
  })
})

describe('loadScreens with sets', () => {
  const FIXTURE = join(import.meta.dirname, '../../__fixtures__/contract')
  const FILE = 'contract/domain/screens/sample/$key.yaml'
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ui-contract-render-sets-'))
    cpSync(FIXTURE, join(root, 'contract'), { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** The fixture's screen with its flow's states `editing` and `saving` listing `listed`, and `sets` as the map. */
  function writeFlow(listed: string, sets: unknown): void {
    const screen = parse(readFileSync(join(root, FILE), 'utf8')) as Record<string, unknown>
    const flow = screen['flow'] as { states: Record<string, Record<string, unknown>> }

    flow.states['editing'] = { ...flow.states['editing'], meta: { renders: [listed] } }
    flow.states['saving'] = { ...flow.states['saving'], meta: { renders: [listed] } }
    screen['flow'] = { ...flow, meta: { renders: sets } }
    writeFileSync(join(root, FILE), stringify(screen))
  }

  it('loads a screen whose states list a set: every reader takes the anchors', () => {
    writeFlow('title', { title: ['sample.title-input', 'sample.save-button'] })

    const loaded = loadScreens(root)
    const flow = loaded.screens?.screens[0]?.flow

    expect(loaded.problems).toEqual([])
    expect(flow?.states['editing']?.meta?.renders).toEqual([
      'sample.title-input',
      'sample.save-button',
    ])
    expect(flow?.states['saving']?.meta?.renders).toEqual([
      'sample.title-input',
      'sample.save-button',
    ])
    expect(flow?.meta).toBeUndefined()
  })

  it('names a set no flow declares at its place in the file', () => {
    writeFlow('titles', { title: ['sample.title-input', 'sample.save-button'] })

    expect(loadScreens(root).problems.map((problem) => problem.message)).toEqual([
      'flow.states.editing.meta.renders: "titles" names no set of flow.meta.renders',
      'flow.states.saving.meta.renders: "titles" names no set of flow.meta.renders',
      'flow.meta.renders.title: the set "title" is listed by no state: a set is for two states or more, list its anchors where a state renders them',
    ])
  })
})
