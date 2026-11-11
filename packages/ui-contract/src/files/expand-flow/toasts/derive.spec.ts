import { describe, expect, it } from 'vitest'

import type { Expansion } from '../expansion'

import { withDerivedToasts } from './derive'

const TOAST = 'app-shell.toast'

/** An expansion of the screen `screen`, whose anchors are the names under it. */
const expansionWith = (
  toast: string | undefined,
  {
    platformToasts = {},
    screen = 'sample',
  }: { platformToasts?: Readonly<Record<string, string>>; screen?: string } = {},
): Expansion => ({
  codesOf: (anchor) => (anchor.startsWith(`${screen}.`) ? [] : undefined),
  failureOf: () => undefined,
  controls: [],
  screen,
  toast,
  platformToasts,
  codeGuards: new Map(),
  issues: [],
  toasts: [],
  writtenToasts: [],
})

const derived = (states: Readonly<Record<string, unknown>>, expansion: Expansion) =>
  withDerivedToasts(states, expansion, ['flow'])

/** One plain state `saving` running `src`, with `extra` on its invoke. */
const saving = (src: string, extra: Record<string, unknown> = {}) => ({
  saving: { invoke: { src, onDone: { target: 'idle' }, ...extra } },
  idle: {},
})

const invokeOf = (states: Readonly<Record<string, unknown>>) =>
  (states['saving'] as { invoke: Record<string, unknown> }).invoke

const shown = (code: string) => ({ type: 'show', params: { anchor: TOAST, codes: [code] } })

describe('withDerivedToasts', () => {
  it('shows the toast on the success of a model action, and records it', () => {
    const expansion = expansionWith(TOAST)
    const states = derived(saving('note.createNote'), expansion)

    expect(invokeOf(states)['onDone']).toEqual({ target: 'idle', actions: [shown('note-created')] })
    expect(expansion.toasts).toEqual([
      { anchor: TOAST, code: 'note-created', action: 'note.createNote' },
    ])
  })

  it('keeps the effects an onDone writes, the toast after them', () => {
    const forget = { type: 'clear', params: { anchor: 'sample.form.error' } }
    const states = derived(
      saving('note.createNote', { onDone: { target: 'idle', actions: [forget] } }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)['onDone']).toEqual({
      target: 'idle',
      actions: [forget, shown('note-created')],
    })
  })

  it('gives every branch of a guarded onDone the toast', () => {
    const states = derived(
      saving('note.updateNote', {
        onDone: [{ target: 'idle', guard: 'left' }, { target: 'idle' }],
      }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)['onDone']).toEqual([
      { target: 'idle', guard: 'left', actions: [shown('note-updated')] },
      { target: 'idle', actions: [shown('note-updated')] },
    ])
  })

  it('keeps read: false on the branch that takes the toast, the toast appended after its effects', () => {
    const reread = { type: 'read', params: { anchor: 'sample.list' } }
    const states = derived(
      saving('note.updateNote', {
        onDone: [
          { target: 'idle', guard: 'left', read: false },
          { target: 'idle', actions: [reread] },
        ],
      }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)['onDone']).toEqual([
      { target: 'idle', guard: 'left', read: false, actions: [shown('note-updated')] },
      { target: 'idle', actions: [reread, shown('note-updated')] },
    ])
  })

  it('keeps a message a branch writes on the toast, and gives the other branches the standard one', () => {
    const unique = shown('name-kept')
    const expansion = expansionWith(TOAST)
    const states = derived(
      saving('profile.updateName', {
        onDone: [
          { target: 'idle', guard: 'left' },
          { target: 'idle', actions: [unique] },
        ],
      }),
      expansion,
    )

    expect(invokeOf(states)['onDone']).toEqual([
      { target: 'idle', guard: 'left', actions: [shown('name-updated')] },
      { target: 'idle', actions: [unique] },
    ])
    expect(expansion.toasts).toEqual([
      { anchor: TOAST, code: 'name-updated', action: 'profile.updateName' },
    ])
  })

  it('derives nothing where every branch writes its own message on the toast', () => {
    const expansion = expansionWith(TOAST, {
      platformToasts: { 'organisations.create': 'organisation-created' },
    })
    const states = derived(
      saving('platform.organisations.create', {
        onDone: { target: 'idle', actions: [shown('organisation-welcome')] },
      }),
      expansion,
    )

    expect(invokeOf(states)['onDone']).toEqual({
      target: 'idle',
      actions: [shown('organisation-welcome')],
    })
    expect(expansion.toasts).toEqual([])
  })

  it('keeps the toast on where the onDone shows on another anchor, a notice or an error', () => {
    const saved = {
      type: 'show',
      params: { anchor: 'app-shell.notice-message', codes: ['saved'] },
    }
    const states = derived(
      saving('profile.updateName', { onDone: { target: 'idle', actions: [saved] } }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)['onDone']).toEqual({
      target: 'idle',
      actions: [saved, shown('name-updated')],
    })
  })

  it("toasts a platform action the platform's map names, with its code, and no other", () => {
    const expansion = expansionWith(TOAST, {
      platformToasts: { 'organisations.create': 'organisation-created' },
    })
    const listed = derived(saving('platform.organisations.create'), expansion)
    const unlisted = derived(saving('platform.organisations.invite'), expansion)

    expect(invokeOf(listed)['onDone']).toEqual({
      target: 'idle',
      actions: [shown('organisation-created')],
    })
    expect(invokeOf(unlisted)['onDone']).toEqual({ target: 'idle' })
    expect(expansion.toasts).toEqual([
      { anchor: TOAST, code: 'organisation-created', action: 'platform.organisations.create' },
    ])
  })

  it('takes toast: false away and derives nothing for it', () => {
    const states = derived(saving('settings.updateLocale', { toast: false }), expansionWith(TOAST))

    expect(invokeOf(states)).toEqual({ src: 'settings.updateLocale', onDone: { target: 'idle' } })
  })

  it('leaves any other toast value for the canonical schema to refuse', () => {
    const states = derived(saving('note.createNote', { toast: true }), expansionWith(TOAST))

    expect(invokeOf(states)['toast']).toBe(true)
    expect(invokeOf(states)['onDone']).toEqual({ target: 'idle' })
  })

  describe('an operation of several actions, as one Save runs them', () => {
    /** The profile's Save: the name, then the bio when it changed; `on` starts it from `idle`. */
    const profile = (
      on: Record<string, unknown>,
      ban: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      idle: { on },
      'saving-name': {
        invoke: {
          src: 'profile.updateName',
          onDone: [{ target: 'saving-bio', guard: 'bioChanged' }, { target: 'idle' }],
          ...ban,
        },
      },
      'saving-bio': { invoke: { src: 'profile.updateBio', onDone: { target: 'idle' }, ...ban } },
    })
    const save = [
      { target: 'saving-name', guard: 'nameChanged' },
      { target: 'saving-bio', guard: 'bioChanged' },
    ]

    it('toasts once, where it ends, with the code of the control that starts it', () => {
      const expansion = expansionWith(TOAST, { screen: 'user.profile' })
      const states = derived(profile({ 'user.profile.save-button': save }), expansion)
      const saved = { anchor: TOAST, code: 'profile-saved', action: 'user.profile.save-button' }

      expect(states).toMatchObject({
        'saving-name': {
          invoke: {
            onDone: [
              { target: 'saving-bio', guard: 'bioChanged' },
              { target: 'idle', actions: [shown('profile-saved')] },
            ],
          },
        },
        'saving-bio': {
          invoke: { onDone: { target: 'idle', actions: [shown('profile-saved')] } },
        },
      })
      expect(
        (states['saving-name'] as { invoke: { onDone: unknown[] } }).invoke.onDone[0],
      ).not.toHaveProperty('actions')
      expect(expansion.toasts).toEqual([saved, saved])
      expect(expansion.issues).toEqual([])
    })

    it('refuses one that no control starts, at the invoke of its first action', () => {
      const expansion = expansionWith(TOAST, { screen: 'user.profile' })
      const states = derived(profile({ 'platform.change-rejected': save }), expansion)

      expect(expansion.issues).toEqual([
        {
          at: ['flow', 'states', 'saving-name', 'invoke'],
          message:
            'the operation of profile.updateName, profile.updateBio is started by what is no control of the screen (platform.change-rejected), so it has no code: show its own message on app-shell.toast or write toast: false',
        },
      ])
      expect(states['saving-bio']).toEqual({
        invoke: { src: 'profile.updateBio', onDone: { target: 'idle' } },
      })
      expect(expansion.toasts).toEqual([])
    })

    it('refuses one that a control and something else start, naming what is no control', () => {
      const expansion = expansionWith(TOAST, { screen: 'user.profile' })

      derived(
        {
          ...profile({ 'user.profile.save-button': save, 'platform.change-rejected': save }),
          leaving: { invoke: { src: 'platform.sign-out', onError: { target: 'saving-name' } } },
        },
        expansion,
      )

      expect(expansion.issues).toEqual([
        {
          at: ['flow', 'states', 'saving-name', 'invoke'],
          message:
            'the operation of profile.updateName, profile.updateBio is started by what is no control of the screen (platform.change-rejected, the outcome of platform.sign-out), so it has no code: show its own message on app-shell.toast or write toast: false',
        },
      ])
    })

    it('refuses one that controls with different codes start', () => {
      const expansion = expansionWith(TOAST, { screen: 'user.profile' })

      derived(
        profile({
          'user.profile.save-button': { target: 'saving-name' },
          'user.profile.save-bio-button': { target: 'saving-bio' },
        }),
        expansion,
      )

      expect(expansion.issues).toEqual([
        {
          at: ['flow', 'states', 'saving-name', 'invoke'],
          message:
            'the operation of profile.updateName, profile.updateBio is started by controls whose codes differ (profile-saved, profile-saved-bio): show its own message on app-shell.toast or write toast: false',
        },
      ])
    })

    it('refuses nothing where the operation toasts nothing', () => {
      const expansion = expansionWith(TOAST, { screen: 'user.profile' })

      derived(profile({ 'platform.change-rejected': save }, { toast: false }), expansion)

      expect(expansion.issues).toEqual([])
      expect(expansion.toasts).toEqual([])
    })
  })

  describe('one event that starts several toasting operations at once', () => {
    const SETTLE = 'write toast: false on every action of all but one'
    const region = (src: string, extra: Record<string, unknown> = {}) => ({
      initial: 'running',
      states: { running: { invoke: { src, onDone: { target: 'done' }, ...extra } }, done: {} },
    })
    const pressed = (src: string, extra: Record<string, unknown> = {}) => ({
      initial: 'idle',
      states: {
        idle: { on: { 'sample.save-button': { target: 'saving' } } },
        saving: { invoke: { src, onDone: { target: 'idle' }, ...extra } },
      },
    })
    /**
     * A region whose first action bans its toast and leads into a second, `ban` on the second;
     * from `idle` Save starts it, or the region starts in it.
     */
    const chained = (initial: 'idle' | 'first', ban: Record<string, unknown>) => ({
      initial,
      states: {
        idle: initial === 'idle' ? { on: { 'sample.save-button': { target: 'first' } } } : {},
        first: { invoke: { src: 'thing.createThing', toast: false, onDone: { target: 'second' } } },
        second: { invoke: { src: 'thing.updateThing', onDone: { target: 'idle' }, ...ban } },
      },
    })

    it('refuses the entry of a parallel state whose regions start them, until all but one are banned', () => {
      const flow = (ban: Record<string, unknown>) => ({
        idle: { on: { 'sample.open-button': { target: 'viewing' } } },
        viewing: {
          type: 'parallel',
          states: { notes: region('note.createNote'), tags: region('tag.createTag', ban) },
        },
      })
      const refused = expansionWith(TOAST)
      const settled = expansionWith(TOAST)

      derived(flow({}), refused)
      derived(flow({ toast: false }), settled)

      expect(refused.issues).toEqual([
        {
          at: ['flow', 'states', 'idle', 'on', 'sample.open-button'],
          message: `starts 2 toasting operations at once (note.createNote, tag.createTag): ${SETTLE}`,
        },
      ])
      expect(settled.issues).toEqual([])
    })

    it('refuses one press that two regions handle side by side, until all but one are banned', () => {
      const flow = (ban: Record<string, unknown>) => ({
        editing: {
          type: 'parallel',
          states: {
            name: pressed('profile.updateName'),
            bio: pressed('profile.updateBio', ban),
          },
        },
      })
      const refused = expansionWith(TOAST)
      const settled = expansionWith(TOAST)

      derived(flow({}), refused)
      derived(flow({ toast: false }), settled)

      expect(refused.issues).toEqual([
        {
          at: ['flow', 'states', 'editing'],
          message: `sample.save-button starts a toasting operation in 2 regions at once (name, bio): ${SETTLE}`,
        },
      ])
      expect(settled.issues).toEqual([])
    })

    it('follows a banned first action to the action after it, on a press and on the entry', () => {
      const pressing = (ban: Record<string, unknown>) => ({
        editing: {
          type: 'parallel',
          states: { things: chained('idle', ban), bio: pressed('profile.updateBio') },
        },
      })
      const entering = (ban: Record<string, unknown>) => ({
        idle: { on: { 'sample.open-button': { target: 'viewing' } } },
        viewing: {
          type: 'parallel',
          states: { things: chained('first', ban), tags: region('tag.createTag') },
        },
      })
      const refused = expansionWith(TOAST)
      const settled = expansionWith(TOAST)

      derived(pressing({}), refused)
      derived(entering({}), refused)
      derived(pressing({ toast: false }), settled)
      derived(entering({ toast: false }), settled)

      expect(refused.issues).toEqual([
        {
          at: ['flow', 'states', 'editing'],
          message: `sample.save-button starts a toasting operation in 2 regions at once (things, bio): ${SETTLE}`,
        },
        {
          at: ['flow', 'states', 'idle', 'on', 'sample.open-button'],
          message: `starts 2 toasting operations at once (thing.createThing, tag.createTag): ${SETTLE}`,
        },
      ])
      expect(settled.issues).toEqual([])
    })

    it('takes one press that leaves the parallel state from two regions as one transition', () => {
      const leaving = {
        initial: 'idle',
        states: { idle: { on: { 'sample.save-button': { target: '#sample.saving' } } } },
      }
      const expansion = expansionWith(TOAST)

      derived(
        {
          editing: { type: 'parallel', states: { name: leaving, bio: leaving } },
          saving: { invoke: { src: 'note.createNote', onDone: { target: 'editing' } } },
        },
        expansion,
      )

      expect(expansion.issues).toEqual([])
      expect(expansion.toasts).toEqual([
        { anchor: TOAST, code: 'note-created', action: 'note.createNote' },
      ])
    })
  })

  describe('a step into the next mutation, wherever the transition enters it', () => {
    /** The toast-free branches of the invoke of `state`: those whose target leads on. */
    const silentAt = (states: Readonly<Record<string, unknown>>, path: readonly string[]) => {
      const node = path.reduce<unknown>(
        (at, name) => (at as { states: Record<string, unknown> }).states[name],
        { states },
      ) as { invoke: { onDone: unknown } }
      const branches = Array.isArray(node.invoke.onDone) ? node.invoke.onDone : [node.invoke.onDone]

      return branches.flatMap((branch: { target: string; actions?: unknown }) =>
        branch.actions === undefined ? [branch.target] : [],
      )
    }
    /** A region editing in `saving`, which Save starts from `idle`. */
    const editor = (saving: Record<string, unknown>, started = true) => ({
      initial: 'idle',
      states: {
        idle: started ? { on: { 'sample.save-button': { target: 'saving' } } } : {},
        saving,
      },
    })
    const create = { idle: { on: { 'sample.create-button': { target: 'creating' } } } }
    const running = (src: string) => ({
      initial: 'running',
      states: { running: { invoke: { src, onDone: { target: 'done' } } }, done: {} },
    })

    it('keeps the toast on a target that is the invoking state itself, which re-enters nothing', () => {
      const states = derived(
        {
          saving: { invoke: { src: 'note.createNote', onDone: { target: 'saving' } } },
          viewing: {
            type: 'parallel',
            states: {
              editor: editor({
                invoke: { src: 'note.updateNote', onDone: { target: 'saving' } },
              }),
            },
          },
        },
        expansionWith(TOAST),
      )

      expect(silentAt(states, ['saving'])).toEqual([])
      expect(silentAt(states, ['viewing', 'editor', 'saving'])).toEqual([])
    })

    it("leads on from a region into a state of the root by the flow's id", () => {
      const states = derived(
        {
          publishing: { invoke: { src: 'thing.publishThing', onDone: { target: 'viewing' } } },
          viewing: {
            type: 'parallel',
            states: {
              editor: editor({
                invoke: {
                  src: 'thing.updateThing',
                  onDone: [{ target: '#sample.publishing', guard: 'publish' }, { target: 'idle' }],
                },
              }),
            },
          },
        },
        expansionWith(TOAST),
      )

      expect(silentAt(states, ['viewing', 'editor', 'saving'])).toEqual(['#sample.publishing'])
    })

    it("leads on into a parallel state whose region starts in a mutation, by name or into another region's state", () => {
      const states = derived(
        {
          ...create,
          creating: {
            invoke: {
              src: 'thing.createThing',
              onDone: [
                { target: 'viewing', guard: 'plain' },
                { target: 'viewing.editor.idle', guard: 'deep' },
                { target: 'done' },
              ],
            },
          },
          viewing: {
            type: 'parallel',
            states: {
              editor: editor({}),
              publish: running('thing.publishThing'),
            },
          },
          done: {},
        },
        expansionWith(TOAST),
      )

      expect(silentAt(states, ['creating'])).toEqual(['viewing', 'viewing.editor.idle'])
    })

    it("leads on into a region's state that runs a mutation, named from the root", () => {
      const states = derived(
        {
          ...create,
          creating: {
            invoke: {
              src: 'thing.createThing',
              onDone: [{ target: 'viewing.editor.saving' }],
            },
          },
          viewing: {
            type: 'parallel',
            states: {
              editor: editor(
                { invoke: { src: 'thing.updateThing', onDone: { target: 'idle' } } },
                false,
              ),
            },
          },
        },
        expansionWith(TOAST),
      )

      expect(silentAt(states, ['creating'])).toEqual(['viewing.editor.saving'])
    })
  })

  it('reaches the invokes of the regions of a parallel state', () => {
    const states = derived(
      {
        viewing: {
          type: 'parallel',
          states: {
            'notes-add': {
              initial: 'idle',
              states: {
                idle: {},
                running: { invoke: { src: 'note.createNote', onDone: { target: 'idle' } } },
              },
            },
          },
        },
      },
      expansionWith(TOAST),
    )

    expect(states).toMatchObject({
      viewing: {
        states: {
          'notes-add': {
            states: { running: { invoke: { onDone: { actions: [shown('note-created')] } } } },
          },
        },
      },
    })
  })

  it('derives nothing without a toast anchor on the frame, and still takes the opt-out away', () => {
    const expansion = expansionWith(undefined)

    expect(invokeOf(derived(saving('note.createNote'), expansion))['onDone']).toEqual({
      target: 'idle',
    })
    expect(
      invokeOf(derived(saving('note.createNote', { toast: false }), expansion)),
    ).not.toHaveProperty('toast')
    expect(expansion.toasts).toEqual([])
  })

  it('derives nothing for a platform action the map does not name', () => {
    const states = derived(saving('platform.sign-out'), expansionWith(TOAST))

    expect(invokeOf(states)['onDone']).toEqual({ target: 'idle' })
  })
})
