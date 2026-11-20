import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { flowStateIn, sampleContract, screenIn } from '../check/contract.fixture'
import { type Flow, formatProblem } from '../files'

import { type Collected, collectFromSource, UNFOLLOWED_SPREAD } from './collect'
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

/**
 * What the sources check collects from the agreeing view with some elements written otherwise, and
 * the `declarations` after them.
 */
function collectedOf(
  changed: Readonly<Record<string, string>> = {},
  declarations: readonly string[] = [],
): Collected {
  const source = [
    ...Object.entries({ ...AGREEING, ...changed }).map(
      ([key, element]) => `const ${key} = ${element}`,
    ),
    ...declarations,
  ].join('\n')

  return collectFromSource(source, 'view.tsx')
}

/** The problems of the agreeing view with some elements written otherwise, in `contract`. */
function problemsOf(
  changed: Readonly<Record<string, string>> = {},
  {
    ahead = false,
    contract = facetsContract(),
    declarations = [],
  }: { ahead?: boolean; contract?: Contract; declarations?: readonly string[] } = {},
): string[] {
  const collected = [collectedOf(changed, declarations)]
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
    /** A title that spreads `fields.name`, whose object spreads one that lacks `name`, with the props of `name`. */
    const grouped = (
      nameProps: string,
      overrides = '{ ...emailOverrides }',
    ): Record<string, string> => ({
      title: '<Input data-testid="sample.title-input" {...fields.name} />',
      nameProps,
      emailOverrides: '{ email: { maxLength: 3 } }',
      overrides,
      fields: '{ name: nameProps, ...overrides }',
    })

    it('reads the mark of a member that a nested spread, lacking the key, lets the scan go on past', () => {
      expect(problemsOf(grouped(`{ 'aria-invalid': ${MARK} }`))).toEqual([])
    })
    it('still wants the mark of such a member when no level of it carries one', () => {
      expect(problemsOf(grouped("{ id: 'title' }"))).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input" carries aria-invalid={concerns === '<key>' ? true : undefined} by the contract: the code "title-taken" of "sample.error" concerns it`,
      ])
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
    /** A title that spreads the result of `markOf()`, a helper written `head { body }`. */
    const helperOf = (body: string, head = '() =>'): Record<string, string> => ({
      title: '<Input data-testid="sample.title-input" {...markOf()} />',
      markOf: `${head} { ${body} }`,
    })
    const missing = `view.tsx:${LINE['title']}: "sample.title-input" carries aria-invalid={concerns === '<key>' ? true : undefined} by the contract: the code "title-taken" of "sample.error" concerns it`

    it('reads the mark of a helper whose if and else both return it, with or without braces', () => {
      const mark = `'aria-invalid': ${MARK}`

      expect(
        problemsOf(
          helperOf(
            `if (concerns === 'title') { return { ${mark} } } else { return { ${mark}, id: 'title' } }`,
          ),
        ),
      ).toEqual([])
      expect(
        problemsOf(
          helperOf(
            `if (concerns === 'title') return { ${mark} }; else return { ${mark}, id: 'a' }`,
          ),
        ),
      ).toEqual([])
    })
    it('still wants the mark when an arm of the if and else returns without it, or does not return', () => {
      const mark = `'aria-invalid': ${MARK}`

      expect(
        problemsOf(
          helperOf(`if (concerns === 'title') { return { ${mark} } } else { return { id: 'a' } }`),
        ),
      ).toEqual([missing])
      expect(
        problemsOf(helperOf(`if (concerns === 'title') { return { ${mark} } } else { log() }`)),
      ).toEqual([missing])
      expect(problemsOf(helperOf(`if (concerns === 'title') { return { ${mark} } }`))).toEqual([
        missing,
      ])
    })
    it('does not take the mark from what an async helper or a generator returns, and refuses the spread', () => {
      const mark = `'aria-invalid': ${MARK}`
      const body = `if (concerns === 'title') { return { ${mark} } } else { return { ${mark}, id: 'title' } }`
      const refused = `view.tsx:${LINE['title']}: ${UNFOLLOWED_SPREAD('sample.title-input')}`

      for (const head of ['async () =>', 'async function ()', 'function* ()']) {
        const changed = helperOf(body, head)

        expect(problemsOf(changed)).toEqual([missing])
        // What the spread cannot be followed to is refused whatever the mode (it is no facet).
        expect(collectedOf(changed).problems.map(formatProblem)).toEqual([refused])
        expect(problemsOf(changed, { ahead: true })).toEqual([])
      }

      // The same helper, not async, is followed and passes.
      expect(collectedOf(helperOf(body)).problems).toEqual([])
    })
    it('does not take the mark of a member that a property with a key it cannot read may replace', () => {
      const marked = `{ 'aria-invalid': ${MARK} }`

      for (const overrides of [
        '{ ...(useDraft ? { [fieldKey]: { maxLength: 3 } } : {}) }',
        '{ ...{ get name() { return { maxLength: 3 } } } }',
      ]) {
        expect(problemsOf(grouped(marked, overrides))).toEqual([missing])
      }
      // A key it can read, a computed string literal included, that is not `name` goes on to it.
      expect(problemsOf(grouped(marked, "{ ...{ ['email']: { maxLength: 3 } } }"))).toEqual([])
    })
    it('holds an element to the anchor its spread supplies in each branch it can follow, and refuses its facts', () => {
      const idProps = { idProps: "{ 'data-testid': 'sample.id-input' }" }
      const element = '<Input {...inputProps.id} maxLength={3} />'
      const refused = `view.tsx:${LINE['id']}: "sample.id-input": maxLength={3}, but ${KIT}`

      // `layoutKey` is 'compact': the member is the id props, whose anchor the element carries.
      expect(
        problemsOf({
          id: element,
          layoutKey: "'compact'",
          inputProps: '{ id: idProps, [layoutKey]: { size: 1 } }',
          ...idProps,
        }),
      ).toEqual([refused])
      // `props.layout` may be 'id': the member is unknown in one branch, and the anchor stands.
      expect(
        problemsOf({
          id: element,
          inputProps: '{ id: idProps, [props.layout]: { size: 1 } }',
          ...idProps,
        }),
      ).toEqual([refused])
    })
    it('takes the key a constant of the file holds as the key, so the property it names replaces the mark', () => {
      const overrides = '{ ...(useDraft ? { [FIELD_KEY]: { maxLength: 3 } } : {}) }'

      expect(
        problemsOf({ ...grouped(`{ 'aria-invalid': ${MARK} }`, overrides), FIELD_KEY: "'name'" }),
      ).toEqual([
        `view.tsx:${LINE['title']}: "sample.title-input": maxLength={3}, but ${KIT}`,
        missing,
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
    it('passes a question whose event type an anchor constant of the view holds, in ahead mode too', () => {
      const held = {
        save: '<Button data-testid={SAVE_TEST_ID} disabled={!props.can(saveEvent)} />',
        SAVE_TEST_ID: "'sample.save-button'",
        saveEvent: '{ type: SAVE_TEST_ID } as const',
      }
      const inline = {
        save: '<Button data-testid={SAVE_TEST_ID} disabled={!props.can({ type: SAVE_TEST_ID })} />',
        SAVE_TEST_ID: "'sample.save-button'",
      }

      for (const changed of [held, inline]) {
        expect(problemsOf(changed)).toEqual([])
        expect(problemsOf(changed, { ahead: true })).toEqual([])
      }
    })
    it('refuses, in ahead mode too, a type constant that names another event, or one the view does not declare', () => {
      const changed = {
        save: '<Button data-testid={SAVE_TEST_ID} disabled={!props.can(saveEvent)} />',
        SAVE_TEST_ID: "'sample.save-button'",
        saveEvent: '{ type: A_TEST_ID } as const',
        A_TEST_ID: "'sample.a-button'",
        a: '<Button data-testid="sample.a-button" disabled={!props.can({ type: IMPORTED_TEST_ID })} />',
      }
      const expected = [
        `view.tsx:${LINE['save']}: "sample.save-button": disabled={!props.can(saveEvent)} asks about "sample.a-button", but the control sends "sample.save-button"`,
        `view.tsx:${LINE['a']}: "sample.a-button": disabled={!props.can({ type: IMPORTED_TEST_ID })}, but the event it asks about cannot be read; write can({ type: 'sample.a-button' }) or a constant of the file that holds it`,
      ]

      expect(problemsOf(changed)).toEqual(expected)
      expect(problemsOf(changed, { ahead: true })).toEqual(expected)
    })
    it('refuses, in ahead mode too, a type a let or a var holds, or an alias or a base behind one, which the view may reassign', () => {
      const asked = (declarations: string, event: string): Record<string, string> => ({
        save: `(() => { ${declarations}; return <Button data-testid="sample.save-button" disabled={!props.can(${event})} /> })()`,
      })
      const cannotRead = (event: string): string[] => [
        `view.tsx:${LINE['save']}: "sample.save-button": disabled={!props.can(${event})}, but the event it asks about cannot be read; write can({ type: 'sample.save-button' }) or a constant of the file that holds it`,
      ]
      const reassigned =
        "let CHECK_TEST_ID = 'sample.save-button'; if (busy) { CHECK_TEST_ID = 'sample.a-button' }"

      for (const [declarations, event] of [
        [reassigned, '{ type: CHECK_TEST_ID }'],
        [`${reassigned}; const event = { type: CHECK_TEST_ID } as const`, 'event'],
        [`${reassigned}; const ALIAS_TEST_ID = CHECK_TEST_ID`, '{ type: ALIAS_TEST_ID }'],
        [
          "var CHECK_TEST_ID = 'sample.help-dialog'; if (busy) { CHECK_TEST_ID = 'sample.a-button' }",
          "{ type: testIdFor(CHECK_TEST_ID, 'confirm-button') }",
        ],
      ] as const) {
        const changed = asked(declarations, event)

        expect(problemsOf(changed)).toEqual(cannotRead(event))
        expect(problemsOf(changed, { ahead: true })).toEqual(cannotRead(event))
      }
    })
    it('passes, in ahead mode too, a type a const holds, through an alias or a base', () => {
      const changed = {
        save: '<Button data-testid="sample.save-button" disabled={!props.can({ type: ALIAS_TEST_ID })} />',
        SAVE_TEST_ID: "'sample.save-button'",
        ALIAS_TEST_ID: 'SAVE_TEST_ID',
      }

      expect(problemsOf(changed)).toEqual([])
      expect(problemsOf(changed, { ahead: true })).toEqual([])
    })
    describe('a question that spreads into an event that writes its own type', () => {
      const cannotRead = (event: string, anchor = 'save'): string[] => [
        `view.tsx:${LINE[anchor]}: "sample.${anchor}-button": disabled={!props.can(${event})}, but the event it asks about cannot be read; write can({ type: 'sample.${anchor}-button' }) or a constant of the file that holds it`,
      ]

      it('refuses it, in ahead mode too, where the type the view gives it allows another event', () => {
        const changed = {
          reset: "{ type: 'sample.a-button' } as const",
          SAVE_TEST_ID: "'sample.save-button'",
          checkFor: '(extra: { type?: typeof reset.type }) => ({ type: SAVE_TEST_ID, ...extra })',
          save: '<Button data-testid={SAVE_TEST_ID} disabled={!props.can(checkFor(reset))} />',
          otherFor: "(extra: { type?: 'other.event' }) => ({ type: 'sample.a-button', ...extra })",
          a: '<Button data-testid="sample.a-button" disabled={!props.can(otherFor(reset))} />',
        }

        for (const ahead of [false, true]) {
          expect(problemsOf(changed, { ahead })).toEqual([
            ...cannotRead('checkFor(reset)'),
            ...cannotRead('otherFor(reset)', 'a'),
          ])
        }
      })
      it('refuses it, in ahead mode too, where the type the view gives it allows any other, or does not say', () => {
        const entries = {
          reset: "{ type: 'sample.a-button' } as const",
          other: "{ type: 'other.event' } as const",
          plain: "{ type: 'sample.a-button' }",
        }
        const imported = "import { imported } from './imported'"

        for (const [extra, declarations] of [
          ['{ type?: string }', []],
          ["{ type?: 'sample.a-button' | 'other.event' }", []],
          ["{ type?: 'sample.a-button' | string }", []],
          ['{ type?: typeof other.type }', []],
          // A `type` the file writes as a plain string is `string`, whatever `plain.type` holds.
          ['{ type?: typeof plain.type }', []],
          ['{ type?: typeof late.type }', ["let late = { type: 'sample.a-button' } as const"]],
          ['{ type?: typeof imported.type }', [imported]],
          ['{ type?: Event }', ["import type { Event } from './event'"]],
          ['{ readonly [key: string]: string }', []],
          ['{ type(): string }', []],
        ] as const) {
          const changed = {
            ...entries,
            literalFor: `(extra: ${extra}) => ({ type: 'sample.a-button', ...extra })`,
            a: '<Button data-testid="sample.a-button" disabled={!props.can(literalFor(reset))} />',
          }

          for (const ahead of [false, true]) {
            expect(problemsOf(changed, { declarations, ahead })).toEqual(
              cannotRead('literalFor(reset)', 'a'),
            )
          }
        }
      })
      it("passes it, in ahead mode too, where the type the view gives it allows only the control's own event", () => {
        for (const extra of [
          '{ type?: typeof reset.type }',
          "{ type?: 'sample.a-button' }",
          "{ readonly type?: 'sample.a-button' | typeof reset.type }",
          "{ type?: ('sample.a-button') }",
        ]) {
          const changed = {
            reset: "{ type: 'sample.a-button' } as const",
            literalFor: `(extra: ${extra}) => ({ type: 'sample.a-button', ...extra })`,
            a: '<Button data-testid="sample.a-button" disabled={!props.can(literalFor(reset))} />',
          }

          expect(problemsOf(changed)).toEqual([])
          expect(problemsOf(changed, { ahead: true })).toEqual([])
        }
      })
      it('passes it, in ahead mode too, through a constant type, an interface or an alias of the view', () => {
        const changed = {
          reset: "{ type: 'sample.save-button' } as const",
          SAVE_TEST_ID: "'sample.save-button'",
          save: '<Button data-testid={SAVE_TEST_ID} disabled={!props.can(saveEvent(reset))} />',
          saveEvent: '(extra: Same) => ({ type: SAVE_TEST_ID, ...extra })',
          a: '<Button data-testid="sample.a-button" disabled={!props.can(aEvent(reset))} />',
          aEvent: "(extra: Alias) => ({ type: 'sample.a-button', ...extra })",
        }
        const declarations = [
          'export interface Same { readonly name?: string; readonly type?: typeof reset.type }',
          "export type Alias = { readonly type?: 'sample.a-button' }",
        ]

        expect(problemsOf(changed, { declarations })).toEqual([])
        expect(problemsOf(changed, { declarations, ahead: true })).toEqual([])
      })
      it('reads the const a typeof names through its annotation where it has one, and refuses what that allows besides', () => {
        const entries = {
          saveEvent: "{ type: 'sample.save-button' } as const",
          other: "{ type: 'sample.save-button' } as const",
          withExtra: '(extra: { type?: typeof template.type }) => ({ ...saveEvent, ...extra })',
          save: '<Button data-testid="sample.save-button" disabled={!props.can(withExtra(template))} />',
        }
        const declarations = (annotation: string): string[] => [
          "import type { Imported } from './imported'",
          "export interface Narrow { readonly type: 'sample.save-button' }",
          "export interface Wide { readonly type: 'sample.save-button' | 'sample.a-button' }",
          `const template${annotation} = { type: 'sample.save-button' } as const`,
        ]

        // The annotation, not the initializer, is the type of the const: an a-button event fits a
        // template annotated to allow it, and the helper's spread may then replace the save event.
        for (const [annotation, refused] of [
          ['', false],
          [": { readonly type: 'sample.save-button' }", false],
          [': { readonly type: typeof other.type }', false],
          [': Narrow', false],
          [": { readonly type: 'sample.save-button' | 'sample.a-button' }", true],
          [': { readonly type: string }', true],
          [': { readonly type: typeof template.type }', true],
          [': Wide', true],
          [': Imported', true],
        ] as const) {
          for (const ahead of [false, true]) {
            expect(
              problemsOf(entries, { declarations: declarations(annotation), ahead }),
              annotation === '' ? 'unannotated' : annotation,
            ).toEqual(refused ? cannotRead('withExtra(template)') : [])
          }
        }
      })
      it('reads a typeof of a const the view declares with one event, and refuses one that may hold another', () => {
        const entries = {
          withExtra:
            "(extra: { type?: typeof template.type }) => ({ type: 'sample.save-button', ...extra })",
          direct:
            "(extra: { type?: typeof SAVE_TEST_ID }) => ({ type: 'sample.save-button', ...extra })",
        }
        const declarations = (constant: string): string[] => [
          constant,
          'const template: { readonly type: typeof SAVE_TEST_ID } = { type: SAVE_TEST_ID } as const',
        ]
        const save = "'sample.save-button'"

        // The type of a const is its annotation where it has one, else the one string its value
        // writes; `testIdFor()` is typed `string`, which allows any event.
        for (const [constant, refused] of [
          [`const SAVE_TEST_ID = ${save}`, false],
          [`const SAVE_TEST_ID: ${save} = ${save}`, false],
          [`const BASE_TEST_ID = ${save}; const SAVE_TEST_ID = BASE_TEST_ID`, false],
          [`let SAVE_TEST_ID = ${save}`, true],
          [`const SAVE_TEST_ID: string = ${save}`, true],
          [`const BASE_TEST_ID: string = ${save}; const SAVE_TEST_ID = BASE_TEST_ID`, true],
          [`const SAVE_TEST_ID: ${save} | 'sample.a-button' = ${save}`, true],
          ["import { SAVE_TEST_ID } from './ids'", true],
          ["const SAVE_TEST_ID = testIdFor('sample', 'save-button')", true],
          ["const SAVE_TEST_ID = 'sample.a-button'", true],
        ] as const) {
          for (const event of ['withExtra(template)', 'direct(template)']) {
            const changed = {
              ...entries,
              save: `<Button data-testid="sample.save-button" disabled={!props.can(${event})} />`,
            }

            for (const ahead of [false, true]) {
              expect(
                problemsOf(changed, { declarations: declarations(constant), ahead }),
                `${constant}: ${event}`,
              ).toEqual(refused ? cannotRead(event) : [])
            }
          }
        }
      })
      it('reads a typeof of a member by the type its value has, which an assertion gives, in ahead mode too', () => {
        const event = "withExtra({ type: 'sample.a-button' })"
        const entries = {
          saveEvent: "{ type: 'sample.save-button' } as const",
          withExtra: '(extra: { type: typeof eventType }) => ({ ...saveEvent, ...extra })',
          save: `<Button data-testid="sample.save-button" disabled={!props.can(${event})} />`,
        }
        const SAVE = "'sample.save-button'"
        const BOTH = `${SAVE} | 'sample.a-button'`
        /** An event default the helpers share, `eventType` typed from its `type`. */
        const sharing = (...defaults: string[]): string[] => [
          ...defaults,
          'const eventType: typeof defaults.type = defaults.type',
        ]

        // An assertion other than `as const` types a value by its type, which may allow more than
        // the value: the a-button event then fits the helper, and its spread replaces the save event.
        // So does a value typed `string`, or a member a spread supplies, typed as the spread is.
        const rows: ReadonlyArray<readonly [readonly string[], boolean]> = [
          [sharing(`const defaults = { type: ${SAVE} as ${BOTH} } as const`), true],
          [sharing(`const defaults = { type: ${SAVE} as string } as const`), true],
          [
            sharing(
              "import type { Anchor } from './anchor'",
              `const defaults = { type: ${SAVE} as Anchor } as const`,
            ),
            true,
          ],
          [
            sharing(
              `const SAVE_TEST_ID: string = ${SAVE}`,
              'const defaults = { type: SAVE_TEST_ID } as const',
            ),
            true,
          ],
          [sharing("const defaults = { type: testIdFor('sample', 'save-button') } as const"), true],
          [
            sharing(`const base = { type: ${SAVE} }`, 'const defaults = { ...base } as const'),
            true,
          ],
          [[`const eventType = ${SAVE} as ${BOTH}`], true],
          [sharing(`const defaults = { type: ${SAVE} } as const`), false],
          [sharing(`const defaults = { type: ${SAVE} as ${SAVE} } as const`), false],
          [
            sharing(`const defaults = { type: (${SAVE} as const) satisfies string } as const`),
            false,
          ],
          [
            sharing(
              `const SAVE_TEST_ID = ${SAVE}`,
              'const defaults = { type: SAVE_TEST_ID } as const',
            ),
            false,
          ],
          [
            sharing(
              "const base = { type: 'sample.a-button' }",
              `const defaults = { ...base, type: ${SAVE} } as const`,
            ),
            false,
          ],
          [[`const eventType = ${SAVE} as ${SAVE}`], false],
        ]

        for (const [declarations, refused] of rows) {
          for (const ahead of [false, true]) {
            expect(
              problemsOf(entries, { declarations, ahead }),
              `${declarations.join('; ')}${ahead ? ' (ahead)' : ''}`,
            ).toEqual(refused ? cannotRead(event) : [])
          }
        }
      })
      it('passes it, in ahead mode too, where the type the view gives it is indexed by numbers only', () => {
        const changed = {
          save: '<Button data-testid="sample.save-button" disabled={!props.can(saveEvent(payload))} />',
          saveEvent:
            "(extra: { readonly name: string; readonly [slot: number]: string }) => ({ type: 'sample.save-button', ...extra })",
        }

        expect(problemsOf(changed)).toEqual([])
        expect(problemsOf(changed, { ahead: true })).toEqual([])
      })
      it('refuses it, in ahead mode too, where an interface of the view gives it a type, or an index', () => {
        const changed = {
          save: '<Button data-testid="sample.save-button" disabled={!props.can(saveEvent(draft))} />',
          saveEvent: "(extra: Typed) => ({ type: 'sample.save-button', ...extra })",
          a: '<Button data-testid="sample.a-button" disabled={!props.can(aEvent(draft))} />',
          aEvent: "(extra: Indexed) => ({ type: 'sample.a-button', ...extra })",
        }
        const declarations = [
          'export interface Typed { readonly type?: string }',
          'export interface Indexed { readonly [key: string]: string }',
        ]

        for (const ahead of [false, true]) {
          expect(problemsOf(changed, { declarations, ahead })).toEqual([
            ...cannotRead('saveEvent(draft)'),
            ...cannotRead('aEvent(draft)', 'a'),
          ])
        }
      })
      it('passes it, in ahead mode too, where the view does not type it, or types it without a type', () => {
        const changed = {
          save: '<Button data-testid={SAVE_TEST_ID} disabled={!props.can(saveEvent(draft))} />',
          SAVE_TEST_ID: "'sample.save-button'",
          saveEvent: '(extra: { readonly key: string }) => ({ type: SAVE_TEST_ID, ...extra })',
          a: '<Button data-testid="sample.a-button" disabled={!props.can(aEvent(draft))} />',
          aEvent: "(extra: Imported) => ({ type: 'sample.a-button', ...extra })",
        }
        const declarations = ["import type { Imported } from './imported'"]

        expect(problemsOf(changed, { declarations })).toEqual([])
        expect(problemsOf(changed, { declarations, ahead: true })).toEqual([])
      })
    })
    describe('a question that spreads data its view declares the type of', () => {
      /** The save button in a component of the view: its props typed, the draft destructured. */
      const save =
        '(props: { readonly draft: Draft; readonly can: (event: unknown) => boolean }) => { const { draft } = props; return <Button data-testid="sample.save-button" disabled={!props.can({ ...submit, ...draft })} /> }'
      const typed = ['export interface Draft { readonly title: string }']

      it('passes it where that type cannot carry a type, in ahead mode too', () => {
        const changed = { save, submit: "{ type: 'sample.save-button' } as const" }

        expect(problemsOf(changed, { declarations: typed })).toEqual([])
        expect(problemsOf(changed, { declarations: typed, ahead: true })).toEqual([])
      })
      it('refuses it, in ahead mode too, about another event, or where that type may carry a type', () => {
        const other = { save, submit: "{ type: 'sample.a-button' } as const" }
        const own = { save, submit: "{ type: 'sample.save-button' } as const" }
        const carrying = [
          'export interface Draft { readonly title: string; readonly type?: string }',
        ]
        const can = '!props.can({ ...submit, ...draft })'

        for (const ahead of [false, true]) {
          expect(problemsOf(other, { declarations: typed, ahead })).toEqual([
            `view.tsx:${LINE['save']}: "sample.save-button": disabled={${can}} asks about "sample.a-button", but the control sends "sample.save-button"`,
          ])
          expect(problemsOf(own, { declarations: carrying, ahead })).toEqual([
            `view.tsx:${LINE['save']}: "sample.save-button": disabled={${can}}, but the event it asks about cannot be read; write can({ type: 'sample.save-button' }) or a constant of the file that holds it`,
          ])
        }
      })
      it('refuses, in ahead mode too, a question about the event a var of a case of the row holds', () => {
        // A case is no scope of a `var`: the row binds it past the switch, and it hides the outer one.
        const cased = {
          save: '() => { switch (mode) { default: var submit = { type: "sample.a-button" } as const } return <Button data-testid="sample.save-button" disabled={!props.can(submit)} /> }',
          submit: "{ type: 'sample.save-button' } as const",
        }

        for (const ahead of [false, true]) {
          expect(problemsOf(cased, { ahead })).toEqual([
            `view.tsx:${LINE['save']}: "sample.save-button": disabled={!props.can(submit)} asks about "sample.a-button", but the control sends "sample.save-button"`,
          ])
        }
      })
      it('refuses, in ahead mode too, a question a default of a parameter asks about the event around the function', () => {
        // The default does not see the body's `var`: it asks about the file's `submit`.
        const changed = {
          save: '(render = () => <Button data-testid="sample.save-button" disabled={!props.can(submit)} />) => { var submit = { type: "sample.save-button" } as const; return render() }',
          submit: "{ type: 'sample.a-button' } as const",
        }

        for (const ahead of [false, true]) {
          expect(problemsOf(changed, { ahead })).toEqual([
            `view.tsx:${LINE['save']}: "sample.save-button": disabled={!props.can(submit)} asks about "sample.a-button", but the control sends "sample.save-button"`,
          ])
        }
      })
      it('reads, in ahead mode too, the event a file names beside a namespace that names its own', () => {
        const unrelated = ["export namespace Unrelated { const other = { title: 'x' } }"]
        const overridden = {
          save: '<Button data-testid="sample.save-button" disabled={!props.can({ type: \'sample.save-button\', ...other })} />',
          other: "{ type: 'sample.a-button' } as const",
        }
        const own = {
          save: '<Button data-testid="sample.save-button" disabled={!props.can(other)} />',
          other: "{ type: 'sample.save-button' } as const",
        }

        for (const ahead of [false, true]) {
          expect(problemsOf(overridden, { declarations: unrelated, ahead })).toEqual([
            `view.tsx:${LINE['save']}: "sample.save-button": disabled={!props.can({ type: 'sample.save-button', ...other })} asks about "sample.a-button", but the control sends "sample.save-button"`,
          ])
          expect(problemsOf(own, { declarations: unrelated, ahead })).toEqual([])
        }
      })
      it('passes, in ahead mode too, a question about a var of the row a case declares again without a value', () => {
        // The first declaration of the row's scope is read: the one that holds the event.
        const changed = {
          save: '() => { var event: Revoke = { type: "sample.save-button" } as const; switch (mode) { default: var event: Revoke; return <Button data-testid="sample.save-button" disabled={!props.can(event)} /> } }',
        }
        const declarations = ["type Revoke = { readonly type: 'sample.save-button' }"]

        expect(problemsOf(changed, { declarations })).toEqual([])
        expect(problemsOf(changed, { declarations, ahead: true })).toEqual([])
      })
      it('passes, in ahead mode too, a question about the event one declaration of a namespace exports to another', () => {
        const changed = { save: 'null' }
        const declarations = [
          "export namespace Sample { export const submit = { type: 'sample.save-button' } as const }",
          'export namespace Sample { export const Save = () => <Button data-testid="sample.save-button" disabled={!props.can(submit)} /> }',
        ]

        expect(problemsOf(changed, { declarations })).toEqual([])
        expect(problemsOf(changed, { declarations, ahead: true })).toEqual([])
      })
      it('refuses, in ahead mode too, a question in a private namespace about the event the file declares first, though another exports its own', () => {
        // A namespace's names bind in the file, where the file's own `event` comes first.
        const changed = { save: 'null', event: "{ type: 'sample.a-button' } as const" }
        const declarations = [
          "export namespace Sessions { namespace Row { export const event = { type: 'sample.save-button' } as const } }",
          'export namespace Sessions { namespace Row { export const Save = () => <Button data-testid="sample.save-button" disabled={!props.can(event)} /> } }',
        ]
        const line = Object.keys({ ...AGREEING, ...changed }).length + 2

        for (const ahead of [false, true]) {
          expect(problemsOf(changed, { declarations, ahead })).toEqual([
            `view.tsx:${line}: "sample.save-button": disabled={!props.can(event)} asks about "sample.a-button", but the control sends "sample.save-button"`,
          ])
        }
      })
      it('passes, in ahead mode too, a question in a nested namespace about the event its own name holds, declared before another the namespace around exports', () => {
        const changed = { save: 'null' }
        const declarations = [
          'export namespace Sessions.Row { const event = { type: "sample.save-button" } as const; export const Save = () => <Button data-testid="sample.save-button" disabled={!props.can(event)} /> }',
          "export namespace Sessions { export const event = { type: 'sample.a-button' } as const }",
        ]

        expect(problemsOf(changed, { declarations })).toEqual([])
        expect(problemsOf(changed, { declarations, ahead: true })).toEqual([])
      })
      it('refuses it, in ahead mode too, where only a case of a switch declares the type of a name the question reads past it', () => {
        // After the switch the name is the parameter again, which the view does not type.
        const changed = {
          save: '({ checkEvent }) => { switch (mode) { case "preview": const checkEvent: Draft = readDraft(); break } return <Button data-testid="sample.save-button" disabled={!props.can({ ...submit, ...checkEvent })} /> }',
          submit: "{ type: 'sample.save-button' } as const",
        }

        for (const ahead of [false, true]) {
          expect(problemsOf(changed, { declarations: typed, ahead })).toEqual([
            `view.tsx:${LINE['save']}: "sample.save-button": disabled={!props.can({ ...submit, ...checkEvent })}, but the event it asks about cannot be read; write can({ type: 'sample.save-button' }) or a constant of the file that holds it`,
          ])
        }
      })
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
