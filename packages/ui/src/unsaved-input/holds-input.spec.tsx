import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FieldFactsProvider } from '@workspace/ui/field-facts'

import { useHoldsInput } from '.'

/** Shows whether a field with its own `own`, rendering `anchor`, holds the input typed in it. */
function Holds(props: {
  readonly own?: boolean | undefined
  readonly anchor?: string | undefined
}) {
  return <output data-testid="holds">{String(useHoldsInput(props.own, props.anchor))}</output>
}

const holds = () => screen.getByTestId('holds').textContent

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('whether a field holds input', () => {
  it('is true unless its own say or its facts say otherwise', () => {
    render(<Holds anchor="x.once-select" />)
    expect(holds()).toBe('true')

    cleanup()
    render(
      <FieldFactsProvider facts={{ 'x.once-select': {} }}>
        <Holds anchor="x.once-select" />
      </FieldFactsProvider>,
    )
    expect(holds()).toBe('true')
  })

  it('takes its facts by its anchor, and only by its anchor', () => {
    const facts = { 'x.once-select': { holdsInput: false } }

    render(
      <FieldFactsProvider facts={facts}>
        <Holds anchor="x.once-select" />
      </FieldFactsProvider>,
    )
    expect(holds()).toBe('false')

    cleanup()
    render(
      <FieldFactsProvider facts={facts}>
        <Holds anchor="x.other-select" />
      </FieldFactsProvider>,
    )
    expect(holds()).toBe('true')

    cleanup()
    render(
      <FieldFactsProvider facts={facts}>
        <Holds />
      </FieldFactsProvider>,
    )
    expect(holds()).toBe('true')
  })

  it("is its own say before its facts', either way", () => {
    render(
      <FieldFactsProvider facts={{ 'x.once-select': { holdsInput: false } }}>
        <Holds own anchor="x.once-select" />
      </FieldFactsProvider>,
    )
    expect(holds()).toBe('true')

    cleanup()
    render(
      <FieldFactsProvider facts={{ 'x.once-select': { holdsInput: true } }}>
        <Holds own={false} anchor="x.once-select" />
      </FieldFactsProvider>,
    )
    expect(holds()).toBe('false')
  })
})
