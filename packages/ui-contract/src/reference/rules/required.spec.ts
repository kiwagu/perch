import { describe, expect, it } from 'vitest'

import { REFERENCE_RULES } from './index'

/** The text of the rule `id` of the registry. */
function textOf(id: string): string {
  const rule = REFERENCE_RULES.find((candidate) => candidate.id === id)

  if (rule === undefined) {
    throw new Error(`no rule ${id}`)
  }

  return rule.text
}

describe('the rule of a field that must be filled', () => {
  it('says a blocked press shows no new code, what the page showed staying', () => {
    expect(textOf('required-field')).toContain(
      'the flow shows no new code (what the page already showed stays)',
    )
  })
  it('says a view never writes it, and a field without the mark may be pressed empty', () => {
    const text = textOf('required-field')

    expect(text).toContain("the kit puts `required` on the field's element from them")
    expect(text).toContain('A view never writes `required`: the sources check refuses one')
    expect(text).toContain('A field without the mark may be pressed empty')
    expect(text).not.toContain('not said to be optional')
  })
  it('names no other rule, as the manifest carries only the rules it names itself', () => {
    expect(textOf('required-field')).not.toContain('see the rule')
  })
  it('joins the lists of the checks and of what a rename carries', () => {
    const texts = REFERENCE_RULES.map(({ text }) => text)

    expect(
      texts.some((text) =>
        text.includes(
          '`required` (`true`) is on an `input` or a `textarea` that holds input alone',
        ),
      ),
    ).toBe(true)
    expect(
      texts.some((text) => text.includes('error fields, input, colour, filling, questions')),
    ).toBe(true)
  })
  it('says a state never disables a text field that is not read-only', () => {
    expect(textOf('renders')).toContain(
      'a text field that is not read-only takes typing in every state that renders it',
    )
  })
  it('names required among what the kit takes from the field facts and the sources check refuses', () => {
    const kit = textOf('emitted-modules').split('The kit finds')[1] ?? ''

    expect(kit).toContain(
      "the entry's `maxLength`, `required`, `type`, `marksState` and `holdsInput`",
    )
    expect(kit).toContain('the sources check refuses a `maxLength`, a `required`,')
  })
})
