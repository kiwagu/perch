import { describe, expect, it } from 'vitest'

import { withDerivedQuestions, withQuestionCodes } from './questions'

const FILE = 'contract/domain/screens/sample.yaml'
const DIALOG = 'app-shell.confirmation'

/** A screen as read, with `anchors`. */
const screenWith = (anchors: Record<string, unknown>) => ({ id: 'sample', anchors })

const deleting = {
  kind: 'button',
  binding: { action: 'note.deleteNote', params: { id: 'sample.notes.item' } },
}
const saving = { kind: 'button', binding: { action: 'note.updateNote' } }

describe('withDerivedQuestions', () => {
  it('makes a control of a destructive action ask, with the code of its action', () => {
    const { value, questions, problems } = withDerivedQuestions(
      FILE,
      screenWith({ 'sample.notes.delete-button': deleting, 'sample.notes.save-button': saving }),
      DIALOG,
    )

    expect(value).toEqual(
      screenWith({
        'sample.notes.delete-button': {
          ...deleting,
          asks: { dialog: DIALOG, code: 'note-delete' },
        },
        'sample.notes.save-button': saving,
      }),
    )
    expect(questions).toEqual([{ anchor: DIALOG, code: 'note-delete', action: 'note.deleteNote' }])
    expect(problems).toEqual([])
  })

  it('asks for a control with several bindings when one of them destroys', () => {
    const both = {
      kind: 'button',
      binding: [saving.binding, { action: 'platform.devices.revoke' }],
    }
    const { value } = withDerivedQuestions(FILE, screenWith({ 'sample.both-button': both }), DIALOG)

    expect(value).toEqual(
      screenWith({
        'sample.both-button': { ...both, asks: { dialog: DIALOG, code: 'devices-revoke' } },
      }),
    )
  })

  it('takes confirm: false away and asks nothing for that control', () => {
    const { value, questions } = withDerivedQuestions(
      FILE,
      screenWith({ 'sample.notes.delete-button': { ...deleting, confirm: false } }),
      DIALOG,
    )

    expect(value).toEqual(screenWith({ 'sample.notes.delete-button': deleting }))
    expect(questions).toEqual([])
  })

  it('refuses confirm: false on a control whose action destroys nothing', () => {
    const { problems } = withDerivedQuestions(
      FILE,
      screenWith({ 'sample.notes.save-button': { ...saving, confirm: false } }),
      DIALOG,
    )

    expect(problems).toEqual([
      {
        file: FILE,
        message:
          'anchors["sample.notes.save-button"].confirm: confirm: false bans no question: the control runs no destructive action',
      },
    ])
  })

  it('leaves any other confirm value for the canonical schema to refuse', () => {
    const anchors = { 'sample.notes.delete-button': { ...deleting, confirm: true } }
    const { value } = withDerivedQuestions(FILE, screenWith(anchors), DIALOG)

    expect(value).toEqual(screenWith(anchors))
  })

  it('asks nothing without a confirmation on the frame, and still takes the ban away', () => {
    const { value, questions } = withDerivedQuestions(
      FILE,
      screenWith({
        'sample.notes.delete-button': deleting,
        'sample.other-button': { ...deleting, confirm: false },
      }),
      undefined,
    )

    expect(value).toEqual(
      screenWith({ 'sample.notes.delete-button': deleting, 'sample.other-button': deleting }),
    )
    expect(questions).toEqual([])
  })
})

describe('a question written in a screen file', () => {
  const written = { dialog: 'elsewhere.confirmation', code: 'invented' }
  const message = (anchor: string) =>
    `anchors["${anchor}"].asks: asks is derived from the control's action: a screen file never writes it`

  it('is refused and taken away, on any control, banned or not, and the derived one stands', () => {
    const { value, problems } = withDerivedQuestions(
      FILE,
      screenWith({
        'sample.open-button': { kind: 'button', binding: { route: '/' }, asks: written },
        'sample.notes.delete-button': { ...deleting, asks: written },
        'sample.other-button': { ...deleting, confirm: false, asks: written },
      }),
      DIALOG,
    )

    expect(value).toEqual(
      screenWith({
        'sample.open-button': { kind: 'button', binding: { route: '/' } },
        'sample.notes.delete-button': {
          ...deleting,
          asks: { dialog: DIALOG, code: 'note-delete' },
        },
        'sample.other-button': deleting,
      }),
    )
    expect(problems.map(({ message: text }) => text)).toEqual([
      message('sample.open-button'),
      message('sample.notes.delete-button'),
      message('sample.other-button'),
    ])
  })
})

describe('withQuestionCodes', () => {
  const dialog = { kind: 'confirmation', derived: ['confirm-button', 'cancel-button'] }

  it("gives the frame's confirmation the codes it asks with, in place of any it writes", () => {
    expect(withQuestionCodes(screenWith({ [DIALOG]: dialog }), DIALOG, ['note-delete'])).toEqual(
      screenWith({ [DIALOG]: { ...dialog, codes: ['note-delete'] } }),
    )
    expect(
      withQuestionCodes(screenWith({ [DIALOG]: { ...dialog, codes: [] } }), DIALOG, [
        'note-delete',
      ]),
    ).toEqual(screenWith({ [DIALOG]: { ...dialog, codes: ['note-delete'] } }))
  })
})
