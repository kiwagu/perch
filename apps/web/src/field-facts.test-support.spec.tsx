// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { Input } from '@workspace/ui/components/ui/input'
import { Textarea } from '@workspace/ui/components/ui/textarea'
import type { FieldFactsByAnchor } from '@workspace/ui/field-facts'

import { expectFieldFacts, renderWithFacts } from './field-facts.test-support'
import { FIELD_FACTS } from './platform/field-facts.gen'
import { renderWithProviders } from './test-utils'

/** A field with every fact, one that declares none, and the anchors a view's other fields render. */
const FACTS: FieldFactsByAnchor = {
  'x.name-input': { maxLength: 7, type: 'email', marksState: false },
  'x.plain-input': {},
}

const AGREEING: ReactElement = (
  <Input data-testid="x.name-input" maxLength={7} type="email" marksState={false} />
)

describe('expectFieldFacts', () => {
  it('holds the declared fields rendered and answers their anchors, the others left alone', () => {
    const { container } = renderWithProviders(
      <>
        {AGREEING}
        <Textarea data-testid="x.plain-input" />
        <Input data-testid="x.undeclared-input" maxLength={99} />
      </>,
    )

    expect(expectFieldFacts(container, FACTS)).toEqual(['x.name-input', 'x.plain-input'])
  })

  it.each([
    [
      'a limit that is not the facts',
      <Input data-testid="x.name-input" maxLength={8} type="email" marksState={false} />,
      /x\.name-input: its maxlength/,
    ],
    [
      'no limit where the facts give one',
      <Input data-testid="x.name-input" type="email" marksState={false} />,
      /x\.name-input: its maxlength/,
    ],
    [
      'a limit where the facts give none',
      <Input data-testid="x.plain-input" maxLength={7} />,
      /x\.plain-input: its maxlength/,
    ],
    [
      'a type that is not the facts',
      <Input data-testid="x.name-input" maxLength={7} type="text" marksState={false} />,
      /x\.name-input: its type/,
    ],
    [
      'no type where the facts give one',
      <Input data-testid="x.name-input" maxLength={7} marksState={false} />,
      /x\.name-input: its type/,
    ],
    [
      'a state colour where the facts opt the field out',
      <Input data-testid="x.name-input" maxLength={7} type="email" />,
      /x\.name-input: its state colours/,
    ],
  ])('fails on %s', (_name, field, message) => {
    const { container } = renderWithProviders(field)

    expect(() => expectFieldFacts(container, FACTS)).toThrow(message)
  })

  it('fails when the container renders no field the facts declare', () => {
    const { container } = renderWithProviders(
      <>
        <Input data-testid="x.undeclared-input" />
        <Input data-testid="constructor" />
      </>,
    )

    expect(() => expectFieldFacts(container, FACTS)).toThrow(/renders no field/)
  })

  it('passes on a field the facts and the element agree on', () => {
    const { container } = renderWithProviders(AGREEING)

    expect(() => expectFieldFacts(container, FACTS)).not.toThrow()
  })
})

describe('renderWithFacts', () => {
  const limited = Object.entries(FIELD_FACTS).flatMap(([anchor, facts]) =>
    'maxLength' in facts ? [{ anchor, maxLength: facts.maxLength }] : [],
  )

  it('gives a field the limit the generated facts say of its anchor', () => {
    const { container } = renderWithFacts(
      <div>
        {limited.map(({ anchor }) => (
          <Input key={anchor} data-testid={anchor} />
        ))}
      </div>,
    )

    expect(limited.length).toBeGreaterThan(0)
    expect(expectFieldFacts(container)).toEqual(limited.map(({ anchor }) => anchor))

    for (const { anchor, maxLength } of limited) {
      expect(
        container.querySelector<HTMLInputElement>(`[data-testid="${anchor}"]`)?.maxLength,
      ).toBe(maxLength)
    }
  })

  it('keeps the facts when the view renders again', () => {
    const [first] = limited
    const anchor = first?.anchor ?? ''
    const { container, rerender } = renderWithFacts(<Input data-testid={anchor} />)

    rerender(<Input data-testid={anchor} placeholder="again" />)

    expect(expectFieldFacts(container)).toEqual([anchor])
  })

  it('differs from renderWithProviders, whose fields take no facts', () => {
    const [first] = limited
    const { container } = renderWithProviders(<Input data-testid={first?.anchor ?? ''} />)

    expect(() => expectFieldFacts(container)).toThrow(/its maxlength/)
  })
})
