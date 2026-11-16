import { DELETE_REFUSED, forget, NOTE_DELETED, NOTE_REFUSED, NOTE_UPDATED } from './effects'
import { taken } from './events'

/**
 * The region of the screen's flow for the notes' items: one note is edited at a time, the one
 * acted on last; another item's edit or delete closes the open edit form, dropping its text.
 */
export const NOTE_ITEMS_REGION = {
  initial: 'idle',
  states: {
    idle: {
      on: {
        'organisation.notes.edit-button': { target: 'editing', actions: 'open' },
        'organisation.notes.delete-button': { target: 'deleting' },
      },
    },
    editing: {
      meta: {
        renders: ['organisation.notes.edit-textarea', 'organisation.notes.save-button'],
      },
      on: {
        'organisation.notes.save-button': { target: 'saving' },
        'organisation.notes.edit-button': { target: 'editing', actions: 'open' },
        'organisation.notes.delete-button': { target: 'deleting' },
      },
    },
    saving: {
      meta: {
        renders: ['organisation.notes.edit-textarea', 'organisation.notes.save-button'],
      },
      invoke: {
        src: 'note.updateNote',
        input: taken('organisation.notes.save-button'),
        onDone: { target: 'idle', actions: [forget('notes'), NOTE_UPDATED] },
        onError: { target: 'editing', actions: [NOTE_REFUSED] },
      },
    },
    deleting: {
      invoke: {
        src: 'note.deleteNote',
        input: taken('organisation.notes.delete-button'),
        onDone: { target: 'idle', actions: [forget('notes'), NOTE_DELETED] },
        onError: { target: 'idle', actions: [DELETE_REFUSED] },
      },
    },
  },
} as const
