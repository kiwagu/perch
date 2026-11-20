import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { flowStateIn, sampleContract, screenIn } from '../check/contract.fixture'
import { type Flow, formatProblem } from '../files'

import { collectFromSource } from './collect'
import { facetProblems } from './facets'

/**
 * The sample with one screen of controls: a field whose value takes at most 80 characters (its
 * model field's `maxLength`, which the view leaves to its kit) and which an error's code concerns,
 * a read-only field whose value has a `maxLength` too, a textarea without a value, and controls a
 * flow of two states handles: the save button only while editing, a button in both states, one only
 * while editing that only editing renders, one no state handles, and a link only while editing.
 */
function facetsContract(): Contract {
  const contract = sampleContract()
  const screen = screenIn(contract, 'sample')
  const thing = contract.model.entities['thing']

  if (thing === undefined) {
    throw new Error('the sample has the entity thing')
  }

  thing.fields['title'] = { type: 'string', readonly: false, maxLength: 80 }
  thing.fields['id'] = { type: 'string', readonly: true, maxLength: 64 }
  screen.anchors = {
    'sample.page': { kind: 'page' },
    'sample.title-input': { kind: 'input', binding: { model: 'thing.title' } },
    'sample.id-input': { kind: 'input', binding: { model: 'thing.id' } },
    'sample.note-textarea': { kind: 'textarea' },
    'sample.error': {
      kind: 'error',
      codes: ['title-taken', 'failed'],
      fields: { 'title-taken': 'sample.title-input', failed: 'form' },
    },
    'sample.save-button': { kind: 'button' },
    'sample.a-button': { kind: 'button' },
    'sample.b-button': { kind: 'button' },
    'sample.c-button': { kind: 'button' },
    'sample.home-link': { kind: 'link' },
  }
  screen.flow = {
    initial: 'editing',
    states: {
      editing: {
        meta: { renders: ['sample.b-button'] },
        on: {
          'sample.save-button': { target: 'saving' },
          'sample.a-button': { target: 'editing' },
          'sample.b-button': { target: 'editing' },
          'sample.home-link': { target: 'editing' },
        },
      },
      saving: { on: { 'sample.a-button': { target: 'editing' } } },
    },
  }

  return contract
}

const MARK = "concerns === 'title' ? true : undefined"
const KIT = "the kit takes it from the contract's field facts; leave it out"
const CAN = "!props.can({ type: 'sample.save-button' })"

/** The view that agrees with the contract, one element a line. */
const AGREEING: Readonly<Record<string, string>> = {
  title: `<Input data-testid="sample.title-input" aria-invalid={${MARK}} />`,
  id: '<Input data-testid="sample.id-input" />',
  note: '<Textarea data-testid="sample.note-textarea" />',
  save: `<Button data-testid="sample.save-button" disabled={${CAN}} />`,
  a: '<Button data-testid="sample.a-button" />',
  b: '<Button data-testid="sample.b-button" />',
  c: '<Button data-testid="sample.c-button" />',
  home: '<Link data-testid="sample.home-link" />',
}

/** Where each element of the view is: its line. */
const LINE: Readonly<Record<string, number>> = Object.fromEntries(
  Object.keys(AGREEING).map((key, index) => [key, index + 1]),
)

/** The problems of the agreeing view with some elements written otherwise, in `contract`. */
function problemsOf(
  changed: Readonly<Record<string, string>> = {},
  { ahead = false, contract = facetsContract() }: { ahead?: boolean; contract?: Contract } = {},
): string[] {
  const elements = { ...AGREEING, ...changed }
  const source = Object.entries(elements)
    .map(([key, element]) => `const ${key} = ${element}`)
    .join('\n')
  const collected = [collectFromSource(source, 'view.tsx')]
  const rendered = new Map(
    collected.flatMap(({ file, literals }) =>
      literals.map(({ anchor, line }) => [anchor, { file, line }] as const),
    ),
  )

  return facetProblems({ collected, screens: contract.screens, rendered, ahead }).map(formatProblem)
}

describe('facetProblems', () => {
  it('passes the view that writes each facet where the contract calls for it, as its idiom', () => {
    expect(problemsOf()).toEqual([])
    expect(problemsOf({}, { ahead: true })).toEqual([])
  })
  it('refuses a facet on a part derived from a declared base, and leaves an undeclared base to the parts check', () => {
    expect(
      problemsOf({
        part: "<Input testId={testIdFor('sample.title-input', 'visibility-button')} maxLength={80} />",
        gone: "<Select testId={testIdFor('sample.gone-list', 'size-select')} maxLength={80} />",
      }),
    ).toEqual([`view.tsx:9: "sample.title-input.visibility-button": maxLength={80}, but ${KIT}`])
  })

  describe('the limit and the type of a text field, which the kit takes from the contract', () => {
    // The sample's model gives `thing.title` at most 80 characters, and the agreeing view lacks it.
    it('refuses a maxLength a view writes, whatever the number or the way it is written, in ahead mode too', () => {
      for (const written of [
        'maxLength={80}',
        'maxLength={81}',
        'maxLength={TITLE_MAX}',
        'maxLength="80"',
      ]) {
        const title = `<Input data-testid="sample.title-input" ${written} aria-invalid={${MARK}} />`
        const expected = [`view.tsx:${LINE['title']}: "sample.title-input": ${written}, but ${KIT}`]

        expect(problemsOf({ title })).toEqual(expected)
        expect(problemsOf({ title }, { ahead: true })).toEqual(expected)
      }
    })
    it('refuses a maxLength a helper of the view supplies through a spread, in ahead mode too', () => {
      const changed = {
        title: `<Input data-testid="sample.title-input" {...field('title')} aria-invalid={${MARK}} />`,
        field: '(name) => ({ id: name, maxLength: 80 })',
      }
      const expected = [
        `view.tsx:${LINE['title']}: "sample.title-input": maxLength={80}, but ${KIT}`,
      ]

      expect(problemsOf(changed)).toEqual(expected)
      expect(problemsOf(changed, { ahead: true })).toEqual(expected)
    })
    it('refuses a maxLength on a read-only field and on a field whose value has none, in ahead mode too', () => {
      const changed = {
        id: '<Input data-testid="sample.id-input" maxLength={64} />',
        note: '<Textarea data-testid="sample.note-textarea" maxLength={500} />',
      }
      const expected = [
        `view.tsx:${LINE['id']}: "sample.id-input": maxLength={64}, but ${KIT}`,
        `view.tsx:${LINE['note']}: "sample.note-textarea": maxLength={500}, but ${KIT}`,
      ]

      expect(problemsOf(changed)).toEqual(expected)
      expect(problemsOf(changed, { ahead: true })).toEqual(expected)
    })
    it('refuses a type a view writes on a text field, an email or any other, in ahead mode too', () => {
      for (const written of ['type="email"', 'type="text"', "type={shown ? 'text' : 'password'}"]) {
        const changed = {
          title: `<Input data-testid="sample.title-input" ${written} aria-invalid={${MARK}} />`,
          id: `<Input data-testid="sample.id-input" ${written} />`,
          note: `<Textarea data-testid="sample.note-textarea" ${written} />`,
        }
        const expected = [
          `view.tsx:${LINE['title']}: "sample.title-input": ${written}, but ${KIT}`,
          `view.tsx:${LINE['id']}: "sample.id-input": ${written}, but ${KIT}`,
          `view.tsx:${LINE['note']}: "sample.note-textarea": ${written}, but ${KIT}`,
        ]

        expect(problemsOf(changed)).toEqual(expected)
        expect(problemsOf(changed, { ahead: true })).toEqual(expected)
      }
    })
    it('lets a type stand on a control that is no text field: a button, a link, a part of a field', () => {
      const changed = {
        save: `<Button data-testid="sample.save-button" type="submit" disabled={${CAN}} />`,
        a: '<Button data-testid="sample.a-button" type="button" />',
        home: '<Link data-testid="sample.home-link" type="text/html" />',
        part: `<Button testId={testIdFor('sample.title-input', 'visibility-button')} type="button" />`,
      }

      expect(problemsOf(changed)).toEqual([])
      expect(problemsOf(changed, { ahead: true })).toEqual([])
    })
  })

  describe('the mark of the field an error concerns', () => {
    it("wants aria-invalid on each field an error's fields name, never on form", () => {
      expect(problemsOf({ title: '<Input data-testid="sample.title-input" />' })).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input" carries aria-invalid={concerns === '<key>' ? true : undefined} by the contract: the code "title-taken" of "sample.error" concerns it`,
      ])
    })
    it('refuses aria-invalid written in another idiom', () => {
      expect(
        problemsOf({
          title: '<Input data-testid="sample.title-input" aria-invalid={invalid} />',
        }),
      ).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input": aria-invalid={invalid}, but the contract says aria-invalid={concerns === '<key>' ? true : undefined}`,
      ])
    })
    it('refuses aria-invalid on a field no error names; in ahead mode one in its idiom lags the contract', () => {
      const id = `<Input data-testid="sample.id-input" aria-invalid={concerns === 'id' ? true : undefined} />`

      expect(problemsOf({ id })).toEqual([
        `view.tsx:${LINE['id']}: "sample.id-input": aria-invalid={concerns === 'id' ? true : undefined}, but no error of its screen names it in its fields; leave it out`,
      ])
      expect(problemsOf({ id }, { ahead: true })).toEqual([])
    })
    it('passes, in ahead mode only, the mark of a field whose error code the contract moved to the form', () => {
      const contract = facetsContract()
      const error = screenIn(contract, 'sample').anchors['sample.error']

      if (error === undefined) {
        throw new Error('the sample has the anchor sample.error')
      }

      error.fields = { 'title-taken': 'form', failed: 'form' }

      expect(problemsOf({}, { contract })).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input": aria-invalid={${MARK}}, but no error of its screen names it in its fields; leave it out`,
      ])
      expect(problemsOf({}, { contract, ahead: true })).toEqual([])
    })
    it('refuses, in ahead mode too, a mark the contract does not call for in another idiom or on a control', () => {
      const changed = {
        id: '<Input data-testid="sample.id-input" aria-invalid={invalid} />',
        a: `<Button data-testid="sample.a-button" aria-invalid={concerns === 'a' ? true : undefined} />`,
      }
      const elsewhere = 'but no error of its screen names it in its fields; leave it out'

      expect(problemsOf(changed, { ahead: true })).toEqual([
        `view.tsx:${LINE['id']}: "sample.id-input": aria-invalid={invalid}, ${elsewhere}`,
        `view.tsx:${LINE['a']}: "sample.a-button": aria-invalid={concerns === 'a' ? true : undefined}, ${elsewhere}`,
      ])
    })
    it('reads the mark of a field whose anchor a constant of the file holds, and wants it there', () => {
      const held = { TITLE_TEST_ID: "'sample.title-input'" }
      const constantLine = Object.keys(AGREEING).length + 1

      expect(
        problemsOf({
          ...held,
          title: `<Input data-testid={TITLE_TEST_ID} aria-invalid={${MARK}} />`,
        }),
      ).toEqual([])
      expect(problemsOf({ ...held, title: '<Input data-testid={TITLE_TEST_ID} />' })).toEqual([
        `view.tsx:${constantLine}: "sample.title-input" carries aria-invalid={concerns === '<key>' ? true : undefined} by the contract: the code "title-taken" of "sample.error" concerns it`,
      ])
    })
    it('wants the mark on every branch a spread may take, and reads it there', () => {
      const branches = {
        marked: `{ 'aria-invalid': ${MARK}, id: 'title' }`,
        plain: "{ id: 'title' }",
      }

      expect(
        problemsOf({
          title: '<Input data-testid="sample.title-input" {...(failed ? marked : plain)} />',
          ...branches,
        }),
      ).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input" carries aria-invalid={concerns === '<key>' ? true : undefined} by the contract: the code "title-taken" of "sample.error" concerns it`,
      ])
      expect(
        problemsOf({
          title: '<Input data-testid="sample.title-input" {...(failed ? marked : marked)} />',
          ...branches,
        }),
      ).toEqual([])
    })
    it('wants the mark when a helper returns early without it', () => {
      const helper = {
        markOf: `() => { if (concerns === 'title') return; return { 'aria-invalid': ${MARK} } }`,
      }

      expect(
        problemsOf({
          title: '<Input data-testid="sample.title-input" {...markOf()} />',
          ...helper,
        }),
      ).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input" carries aria-invalid={concerns === '<key>' ? true : undefined} by the contract: the code "title-taken" of "sample.error" concerns it`,
      ])
    })
    it('reads the anchor a spread supplies, and the facts beside it', () => {
      const title = `<Input {...{ testId: 'sample.title-input', maxLength: 80, 'aria-invalid': ${MARK} }} />`

      expect(problemsOf({ title })).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input": maxLength={80}, but ${KIT}`,
      ])
    })
    it('in ahead mode lets a missing mark by', () => {
      expect(
        problemsOf({ title: '<Input data-testid="sample.title-input" />' }, { ahead: true }),
      ).toEqual([])
    })
  })

  describe('the enabling of a control by its machine', () => {
    it('wants disabled={!props.can(...)} on a control a state renders and does not handle', () => {
      expect(problemsOf({ save: '<Button data-testid="sample.save-button" />' })).toEqual([
        `view.tsx:${LINE['save']}: "sample.save-button" carries disabled={!props.can(<its event>)} by the contract: the state "saving" renders it and does not handle it`,
      ])
      expect(
        problemsOf({
          save: '<Button data-testid="sample.save-button" disabled={!can(saveEvent)} />',
          saveEvent: "{ type: 'sample.save-button' } as const",
        }),
      ).toEqual([])
    })
    it('refuses, in ahead mode too, a disabled that asks about another event, or one it cannot read', () => {
      const changed = {
        save: '<Button data-testid="sample.save-button" disabled={!props.can(other)} />',
        other: "{ type: 'sample.a-button' } as const",
        a: '<Button data-testid="sample.a-button" disabled={!props.can(props.event)} />',
      }
      const expected = [
        `view.tsx:${LINE['save']}: "sample.save-button": disabled={!props.can(other)} asks about "sample.a-button", but the control sends "sample.save-button"`,
        `view.tsx:${LINE['a']}: "sample.a-button": disabled={!props.can(props.event)}, but the event it asks about cannot be read; write can({ type: 'sample.a-button' }) or a constant of the file that holds it`,
      ]

      expect(problemsOf(changed)).toEqual(expected)
      expect(problemsOf(changed, { ahead: true })).toEqual(expected)
    })
    it('refuses disabled written in another idiom', () => {
      expect(
        problemsOf({ save: '<Button data-testid="sample.save-button" disabled={busy} />' }),
      ).toEqual([
        `view.tsx:${LINE['save']}: "sample.save-button": disabled={busy}, but the contract says disabled={!props.can(<its event>)}`,
      ])
    })
    it('needs none on a control every state handles or only states that handle it render, and lets it stand', () => {
      expect(
        problemsOf({
          a: '<Button data-testid="sample.a-button" disabled={!props.can({ type: \'sample.a-button\' })} />',
          b: '<Button data-testid="sample.b-button" disabled={!props.can({ type: \'sample.b-button\' })} />',
        }),
      ).toEqual([])
    })
    it('refuses disabled on a control no state handles and on a link; in ahead mode only the link', () => {
      const changed = {
        c: '<Button data-testid="sample.c-button" disabled={!props.can({ type: \'sample.c-button\' })} />',
        home: '<Link data-testid="sample.home-link" disabled={!props.can({ type: \'sample.home-link\' })} />',
      }
      const elsewhere =
        "but no state enables it: only a button, a tab, a select, a checkbox, a radio or a switch whose anchor is an event of its screen's flow is enabled by its machine; leave it out"
      const expected = [
        `view.tsx:${LINE['c']}: "sample.c-button": disabled={!props.can({ type: 'sample.c-button' })}, ${elsewhere}`,
        `view.tsx:${LINE['home']}: "sample.home-link": disabled={!props.can({ type: 'sample.home-link' })}, ${elsewhere}`,
      ]

      expect(problemsOf(changed)).toEqual(expected)
      // A button whose event the contract dropped keeps its enabling until the view follows.
      expect(problemsOf(changed, { ahead: true })).toEqual(expected.slice(1))
    })
    it('refuses a disabled with anything beside its one question, in ahead mode too', () => {
      const save = `<Button data-testid="sample.save-button" disabled={${CAN} || busy} />`
      const c =
        '<Button data-testid="sample.c-button" disabled={!props.can({ type: \'sample.c-button\' }) || busy} />'

      expect(problemsOf({ save })).toEqual([
        `view.tsx:${LINE['save']}: "sample.save-button": disabled={${CAN} || busy}, but the contract says disabled={!props.can(<its event>)}`,
      ])
      expect(problemsOf({ c }, { ahead: true })).toEqual([
        `view.tsx:${LINE['c']}: "sample.c-button": disabled={!props.can({ type: 'sample.c-button' }) || busy}, but no state enables it: only a button, a tab, a select, a checkbox, a radio or a switch whose anchor is an event of its screen's flow is enabled by its machine; leave it out`,
      ])
    })
    it('passes a question whose argument a builder of the view makes, however deep the call', () => {
      expect(
        problemsOf({
          save: '<Button data-testid="sample.save-button" disabled={!props.can(saveEvent(readDraft()))} />',
          saveEvent: "(draft) => ({ type: 'sample.save-button', ...draft })",
        }),
      ).toEqual([])
    })
    it('in ahead mode lets a missing disabled by', () => {
      expect(
        problemsOf({ save: '<Button data-testid="sample.save-button" />' }, { ahead: true }),
      ).toEqual([])
    })

    /**
     * The contract with a dialog whose derived confirm button, a part it lists in `derived`, only
     * the editing state handles: the dialog is listed by no state, so saving renders it too.
     */
    const withDialog = (): Contract => {
      const contract = facetsContract()
      const editing = flowStateIn(contract, 'editing')

      screenIn(contract, 'sample').anchors['sample.help-dialog'] = {
        kind: 'dialog',
        derived: ['confirm-button'],
      }
      editing.on = { ...editing.on, 'sample.help-dialog.confirm-button': { target: 'editing' } }

      return contract
    }

    /** The dialog's confirm button built with `testIdFor()` of two literals, with `props` beside. */
    const confirm = (props: string): Record<string, string> => ({
      confirm: `<Button testId={testIdFor('sample.help-dialog', 'confirm-button')}${props} />`,
    })

    /** The line of the confirm button: after every element of the agreeing view. */
    const CONFIRM_LINE = Object.keys(AGREEING).length + 1

    it('lets a part a declared base derives, built with testIdFor() of two literals, carry its enabling', () => {
      const can = " disabled={!props.can({ type: 'sample.help-dialog.confirm-button' })}"

      expect(problemsOf(confirm(can), { contract: withDialog() })).toEqual([])
      expect(problemsOf(confirm(can), { contract: withDialog(), ahead: true })).toEqual([])
    })
    it('wants the enabling on such a part where a state renders it and does not handle it, except in ahead mode', () => {
      expect(problemsOf(confirm(''), { contract: withDialog() })).toEqual([
        `view.tsx:${CONFIRM_LINE}: "sample.help-dialog.confirm-button" carries disabled={!props.can(<its event>)} by the contract: the state "saving" renders it and does not handle it`,
      ])
      expect(problemsOf(confirm(''), { contract: withDialog(), ahead: true })).toEqual([])
    })
    it('wants the enabling on a part whose base a constant of the file holds, too', () => {
      const held = {
        confirm: "<Button testId={testIdFor(DIALOG_TEST_ID, 'confirm-button')} />",
        DIALOG_TEST_ID: "'sample.help-dialog'",
      }

      expect(problemsOf(held, { contract: withDialog() })).toEqual([
        `view.tsx:${CONFIRM_LINE}: "sample.help-dialog.confirm-button" carries disabled={!props.can(<its event>)} by the contract: the state "saving" renders it and does not handle it`,
      ])
    })
    it('reads the enabling of a part a constant holds whole, built from a constant base', () => {
      const can = "!props.can({ type: 'sample.help-dialog.confirm-button' })"
      const held = {
        confirm: `<Button testId={CONFIRM_TEST_ID} disabled={${can}} />`,
        DIALOG_TEST_ID: "'sample.help-dialog'",
        CONFIRM_TEST_ID: "testIdFor(DIALOG_TEST_ID, 'confirm-button')",
      }

      expect(problemsOf(held, { contract: withDialog() })).toEqual([])
    })
    it('refuses the enabling of such a part written in another idiom, in ahead mode too', () => {
      const expected = [
        `view.tsx:${CONFIRM_LINE}: "sample.help-dialog.confirm-button": disabled={busy}, but the contract says disabled={!props.can(<its event>)}`,
      ]

      expect(problemsOf(confirm(' disabled={busy}'), { contract: withDialog() })).toEqual(expected)
      expect(
        problemsOf(confirm(' disabled={busy}'), { contract: withDialog(), ahead: true }),
      ).toEqual(expected)
    })

    /** The contract with the screen's flow one parallel state of two regions. */
    const parallel = (renders: readonly string[]): Contract => {
      const contract = facetsContract()
      const flow: Flow = {
        initial: 'viewing',
        states: {
          viewing: {
            type: 'parallel',
            on: { 'sample.a-button': { target: 'viewing' } },
            states: {
              form: {
                initial: 'idle',
                states: {
                  idle: {
                    meta: { renders: [...renders] },
                    on: { 'sample.save-button': { target: 'busy' } },
                  },
                  busy: {},
                },
              },
              other: {
                initial: 'one',
                states: { one: { on: { 'sample.b-button': { target: 'one' } } } },
              },
            },
          },
        },
      }

      screenIn(contract, 'sample').flow = flow

      return contract
    }

    it('reads a parallel state: a region state that renders it and does not handle it, while no region and not the parallel state does', () => {
      const save = '<Button data-testid="sample.save-button" />'

      // The parallel state's own `on` handles the a-button, and the region of one state the b-button.
      expect(problemsOf({ save }, { contract: parallel([]) })).toEqual([
        `view.tsx:${LINE['save']}: "sample.save-button" carries disabled={!props.can(<its event>)} by the contract: the state "viewing.form.busy" renders it and does not handle it`,
      ])
      expect(problemsOf({ save }, { contract: parallel(['sample.save-button']) })).toEqual([])
    })
  })
})
