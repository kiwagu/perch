import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { type FieldFacts, FieldFactsProvider, useFieldFacts } from '.'

/** Prints the facts of the field that renders `anchor`, or `none`. */
function Facts(props: { readonly anchor: string | undefined }) {
  const facts: FieldFacts | undefined = useFieldFacts(props.anchor)

  return <output data-testid="facts">{facts === undefined ? 'none' : JSON.stringify(facts)}</output>
}

const facts = () => screen.getByTestId('facts').textContent

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('the facts of a field', () => {
  it('are the entry of the anchor the field renders', () => {
    render(
      <FieldFactsProvider facts={{ 'x.name-input': { maxLength: 7 }, 'x.bio-input': {} }}>
        <Facts anchor="x.name-input" />
      </FieldFactsProvider>,
    )

    expect(facts()).toBe('{"maxLength":7}')
  })

  it('are none without a provider', () => {
    render(<Facts anchor="x.name-input" />)

    expect(facts()).toBe('none')
  })

  it('are none for a field that renders no anchor, or one the provider has no entry for', () => {
    const { rerender } = render(
      <FieldFactsProvider facts={{ 'x.name-input': { maxLength: 7 } }}>
        <Facts anchor={undefined} />
      </FieldFactsProvider>,
    )

    expect(facts()).toBe('none')

    rerender(
      <FieldFactsProvider facts={{ 'x.name-input': { maxLength: 7 } }}>
        <Facts anchor="x.other-input" />
      </FieldFactsProvider>,
    )
    expect(facts()).toBe('none')
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'are none for an anchor named like an Object member (%s)',
    (anchor) => {
      render(
        <FieldFactsProvider facts={{ 'x.name-input': { maxLength: 7 } }}>
          <Facts anchor={anchor} />
        </FieldFactsProvider>,
      )

      expect(facts()).toBe('none')
    },
  )

  it("are the inner provider's alone inside another provider", () => {
    render(
      <FieldFactsProvider facts={{ 'x.name-input': { maxLength: 7 } }}>
        <FieldFactsProvider facts={{ 'x.bio-input': { maxLength: 9 } }}>
          <Facts anchor="x.name-input" />
        </FieldFactsProvider>
      </FieldFactsProvider>,
    )

    expect(facts()).toBe('none')
  })
})
