import { describe, expect, it } from 'vitest'

import { type Failure, withDerivedErrors } from '.'

const FAILURES: Readonly<Record<string, Failure>> = {
  'thing.createThing': {
    codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
    params: { title: ['title-required', 'title-too-long'] },
  },
  'thing.deleteThing': { codes: ['forbidden', 'failed'], params: {} },
  'thing.renameThing': {
    codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
    params: { title: ['title-required', 'title-too-long'] },
  },
  'platform.things.share': { codes: ['not-allowed', 'rate-limited', 'failed'], params: {} },
}

const failureOf = (action: string) => FAILURES[action]

/** A screen whose anchors are `anchors`, its error anchors derived. */
const derived = (anchors: Record<string, unknown>) =>
  (withDerivedErrors({ id: 'sample', anchors }, failureOf) as { anchors: Record<string, unknown> })
    .anchors

describe('withDerivedErrors', () => {
  it('gives an error the codes of the failures its part binds, each once, failed last', () => {
    expect(
      derived({
        'sample.form.delete-button': { kind: 'button', binding: { action: 'thing.deleteThing' } },
        'sample.form.share-button': {
          kind: 'button',
          binding: [{ action: 'thing.createThing' }, { action: 'platform.things.share' }],
        },
        'sample.form.error': { kind: 'error' },
        'sample.other.save-button': { kind: 'button', binding: { action: 'thing.renameThing' } },
        'sample.form.row.save-button': { kind: 'button', binding: { action: 'thing.renameThing' } },
      })['sample.form.error'],
    ).toEqual({
      kind: 'error',
      codes: [
        'forbidden',
        'title-required',
        'title-too-long',
        'not-allowed',
        'rate-limited',
        'failed',
      ],
    })
  })

  it('maps a code of a field to the control its binding passes, unless two pass two controls', () => {
    const anchors = {
      'sample.form.title-input': { kind: 'input' },
      'sample.form.note-textarea': { kind: 'textarea' },
      'sample.form.item': { kind: 'item' },
      'sample.form.add-button': {
        kind: 'button',
        binding: { action: 'thing.createThing', params: { title: 'sample.form.title-input' } },
      },
      'sample.form.error': { kind: 'error' },
    }

    expect(derived(anchors)['sample.form.error']).toEqual({
      kind: 'error',
      codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
      fields: {
        'title-required': 'sample.form.title-input',
        'title-too-long': 'sample.form.title-input',
      },
    })
    expect(
      derived({
        ...anchors,
        'sample.form.rename-button': {
          kind: 'button',
          binding: { action: 'thing.renameThing', params: { title: 'sample.form.note-textarea' } },
        },
      })['sample.form.error'],
    ).toEqual({ kind: 'error', codes: ['forbidden', 'title-required', 'title-too-long', 'failed'] })
    expect(
      derived({
        ...anchors,
        'sample.form.add-button': {
          kind: 'button',
          binding: { action: 'thing.createThing', params: { title: 'sample.form.item' } },
        },
      })['sample.form.error'],
    ).toEqual({ kind: 'error', codes: ['forbidden', 'title-required', 'title-too-long', 'failed'] })
  })

  it('keeps the codes and the fields a file writes, and derives fields only for its codes', () => {
    const anchors = {
      'sample.form.title-input': { kind: 'input' },
      'sample.form.add-button': {
        kind: 'button',
        binding: { action: 'thing.createThing', params: { title: 'sample.form.title-input' } },
      },
    }

    expect(
      derived({ ...anchors, 'sample.form.error': { kind: 'error', codes: ['title-too-long'] } })[
        'sample.form.error'
      ],
    ).toEqual({
      kind: 'error',
      codes: ['title-too-long'],
      fields: { 'title-too-long': 'sample.form.title-input' },
    })
    expect(
      derived({
        ...anchors,
        'sample.form.error': { kind: 'error', fields: { failed: 'sample.form.title-input' } },
      })['sample.form.error'],
    ).toEqual({
      kind: 'error',
      codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
      fields: { failed: 'sample.form.title-input' },
    })
  })

  it('adds the actions the flow invokes against the error and the codes it shows there, failed last', () => {
    const screen = {
      id: 'sample',
      anchors: {
        'sample.form.resend-button': {
          kind: 'button',
          binding: { action: 'platform.things.share' },
        },
        'sample.form.error': { kind: 'error' },
      },
      flow: {
        initial: 'idle',
        states: {
          idle: {
            entry: [{ show: { 'sample.form.error': ['passwords-differ'] } }],
            on: { 'sample.form.resend-button': 'sharing' },
          },
          sharing: {
            invoke: {
              src: 'thing.createThing',
              input: { title: 'sample.form.title-input' },
              onDone: 'idle',
              onError: { target: 'idle', actions: [{ show: 'sample.form.error' }] },
            },
          },
        },
      },
    }

    expect(
      (withDerivedErrors(screen, failureOf) as typeof screen).anchors['sample.form.error'],
    ).toEqual({
      kind: 'error',
      codes: [
        'not-allowed',
        'rate-limited',
        'forbidden',
        'title-required',
        'title-too-long',
        'passwords-differ',
        'failed',
      ],
    })
  })

  it('derives the same codes when a guard by failure code splits the failure across the branches', () => {
    const flowWith = (guards: Record<string, unknown>, guard: string) => ({
      initial: 'idle',
      meta: { guards },
      states: {
        idle: { on: { 'sample.form.share-button': 'sharing' } },
        sharing: {
          invoke: {
            src: 'platform.things.share',
            onDone: 'idle',
            onError: [
              { target: 'idle', guard, actions: [{ show: 'sample.form.error' }] },
              { target: 'idle', actions: [{ show: 'sample.form.error' }] },
            ],
          },
        },
      },
    })
    const errorOf = (flow: unknown) =>
      (
        withDerivedErrors(
          { id: 'sample', anchors: { 'sample.form.error': { kind: 'error' } }, flow },
          failureOf,
        ) as { anchors: Record<string, unknown> }
      ).anchors['sample.form.error']

    expect(errorOf(flowWith({ limited: { codes: ['rate-limited'] } }, 'limited'))).toEqual({
      kind: 'error',
      codes: ['not-allowed', 'rate-limited', 'failed'],
    })
    expect(errorOf(flowWith({ limited: { codes: ['rate-limited'] } }, 'limited'))).toEqual(
      errorOf(flowWith({ limited: 'the network address tried too often' }, 'limited')),
    )
  })

  it('maps a code of a field the flow passes to the action it invokes, and keeps written codes', () => {
    const anchors = {
      'sample.form.title-input': { kind: 'input' },
      'sample.form.error': { kind: 'error' },
    }
    const flow = {
      initial: 'idle',
      states: {
        idle: { on: { 'sample.form.title-input': 'adding' } },
        adding: {
          invoke: {
            src: 'thing.createThing',
            input: { title: 'sample.form.title-input' },
            onDone: 'idle',
          },
        },
      },
    }
    const errorWith = (error: Record<string, unknown>) =>
      (
        withDerivedErrors(
          { id: 'sample', anchors: { ...anchors, 'sample.form.error': error }, flow },
          failureOf,
        ) as { anchors: Record<string, unknown> }
      ).anchors['sample.form.error']

    expect(errorWith({ kind: 'error' })).toEqual({
      kind: 'error',
      codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
      fields: {
        'title-required': 'sample.form.title-input',
        'title-too-long': 'sample.form.title-input',
      },
    })
    expect(errorWith({ kind: 'error', codes: ['failed'] })).toEqual({
      kind: 'error',
      codes: ['failed'],
    })
  })

  it('derives the codes the flow shows under states and regions named entry, exit or actions', () => {
    const show = (code: string) => [{ show: { 'sample.form.error': [code] } }]
    const screen = {
      id: 'sample',
      anchors: { 'sample.form.error': { kind: 'error' } },
      flow: {
        initial: 'entry',
        states: {
          entry: { entry: show('a'), on: { 'sample.form.go-button': 'exit' } },
          exit: { exit: show('b'), on: { 'sample.form.go-button': 'actions' } },
          actions: {
            type: 'parallel',
            states: {
              entry: { initial: 'exit', states: { exit: { entry: show('c') } } },
              actions: { initial: 'actions', states: { actions: { exit: show('d') } } },
            },
          },
        },
      },
    }

    expect(
      (withDerivedErrors(screen, failureOf) as typeof screen).anchors['sample.form.error'],
    ).toEqual({ kind: 'error', codes: ['a', 'b', 'c', 'd'] })
  })

  it('leaves an error whose part binds no action, and every other anchor, as written', () => {
    const anchors = {
      'sample.form.error': { kind: 'error', description: 'Nothing fails here.' },
      'sample.form.save-button': { kind: 'button', binding: { model: 'thing.title' } },
    }

    expect(derived(anchors)).toEqual(anchors)
  })
})
