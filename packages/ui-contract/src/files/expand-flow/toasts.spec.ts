import { describe, expect, it } from 'vitest'

import type { Expansion } from './expansion'
import { toastCodeOf, withDerivedToasts } from './toasts'

const TOAST = 'app-shell.toast'

const expansionWith = (
  toast: string | undefined,
  platformToasts: Readonly<Record<string, string>> = {},
): Expansion => ({
  codesOf: () => [],
  failureOf: () => undefined,
  controls: [],
  screen: 'sample',
  toast,
  platformToasts,
  issues: [],
  toasts: [],
  writtenToasts: [],
})

/** One plain state `saving` running `src`, with `extra` on its invoke. */
const saving = (src: string, extra: Record<string, unknown> = {}) => ({
  saving: { invoke: { src, onDone: { target: 'idle' }, ...extra } },
  idle: {},
})

const invokeOf = (states: Readonly<Record<string, unknown>>) =>
  (states['saving'] as { invoke: Record<string, unknown> }).invoke

const shown = (code: string) => ({ type: 'show', params: { anchor: TOAST, codes: [code] } })

describe('toastCodeOf', () => {
  it('names the object, then the past of create, update or delete', () => {
    expect(toastCodeOf('note.createNote')).toBe('note-created')
    expect(toastCodeOf('note.updateNote')).toBe('note-updated')
    expect(toastCodeOf('note.deleteNote')).toBe('note-deleted')
    expect(toastCodeOf('profile.updateBio')).toBe('bio-updated')
    expect(toastCodeOf('settings.updateLocaleChoice')).toBe('locale-choice-updated')
  })

  it('says another verb is done, and a platform action has no toast', () => {
    expect(toastCodeOf('organisation.inviteMember')).toBe('invite-member-done')
    expect(toastCodeOf('thing.publish')).toBe('publish-done')
    expect(toastCodeOf('platform.organisations.invite')).toBeUndefined()
  })

  it('reads a verb only from its own table, never from what every object inherits', () => {
    expect(toastCodeOf('thing.constructorThing')).toBe('constructor-thing-done')
    expect(toastCodeOf('thing.toStringThing')).toBe('to-string-thing-done')
  })
})

describe('withDerivedToasts', () => {
  it('shows the toast on the success of a model action, and records it', () => {
    const expansion = expansionWith(TOAST)
    const states = withDerivedToasts(saving('note.createNote'), expansion)

    expect(invokeOf(states)['onDone']).toEqual({ target: 'idle', actions: [shown('note-created')] })
    expect(expansion.toasts).toEqual([
      { anchor: TOAST, code: 'note-created', action: 'note.createNote' },
    ])
  })

  it('keeps the effects an onDone writes, the toast after them', () => {
    const forget = { type: 'clear', params: { anchor: 'sample.form.error' } }
    const states = withDerivedToasts(
      saving('note.createNote', { onDone: { target: 'idle', actions: [forget] } }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)['onDone']).toEqual({
      target: 'idle',
      actions: [forget, shown('note-created')],
    })
  })

  it('gives every branch of a guarded onDone the toast', () => {
    const states = withDerivedToasts(
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

  it('derives nothing where the onDone shows on the toast itself: a written message wins', () => {
    const unique = shown('name-kept')
    const expansion = expansionWith(TOAST)
    const states = withDerivedToasts(
      saving('profile.updateName', {
        onDone: [
          { target: 'idle', guard: 'left' },
          { target: 'idle', actions: [unique] },
        ],
      }),
      expansion,
    )

    expect(invokeOf(states)['onDone']).toEqual([
      { target: 'idle', guard: 'left' },
      { target: 'idle', actions: [unique] },
    ])
    expect(expansion.toasts).toEqual([])
  })

  it('keeps the toast on where the onDone shows on another anchor, a notice or an error', () => {
    const saved = {
      type: 'show',
      params: { anchor: 'app-shell.notice-message', codes: ['saved'] },
    }
    const states = withDerivedToasts(
      saving('profile.updateName', { onDone: { target: 'idle', actions: [saved] } }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)['onDone']).toEqual({
      target: 'idle',
      actions: [saved, shown('name-updated')],
    })
  })

  it("toasts a platform action the platform's map names, with its code, and no other", () => {
    const expansion = expansionWith(TOAST, { 'organisations.create': 'organisation-created' })
    const listed = withDerivedToasts(saving('platform.organisations.create'), expansion)
    const unlisted = withDerivedToasts(saving('platform.organisations.invite'), expansion)

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
    const states = withDerivedToasts(
      saving('settings.updateLocale', { toast: false }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)).toEqual({ src: 'settings.updateLocale', onDone: { target: 'idle' } })
  })

  it('leaves any other toast value for the canonical schema to refuse', () => {
    const states = withDerivedToasts(
      saving('note.createNote', { toast: true }),
      expansionWith(TOAST),
    )

    expect(invokeOf(states)['toast']).toBe(true)
    expect(invokeOf(states)['onDone']).toEqual({ target: 'idle' })
  })

  it('reaches the invokes of the regions of a parallel state', () => {
    const states = withDerivedToasts(
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

    expect(invokeOf(withDerivedToasts(saving('note.createNote'), expansion))['onDone']).toEqual({
      target: 'idle',
    })
    expect(
      invokeOf(withDerivedToasts(saving('note.createNote', { toast: false }), expansion)),
    ).not.toHaveProperty('toast')
    expect(expansion.toasts).toEqual([])
  })

  it('derives nothing for a platform action the map does not name', () => {
    const states = withDerivedToasts(saving('platform.sign-out'), expansionWith(TOAST))

    expect(invokeOf(states)['onDone']).toEqual({ target: 'idle' })
  })
})
