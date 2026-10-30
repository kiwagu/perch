import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

const options = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
] as const

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('OptionSelect', () => {
  it('marks the trigger with its anchor and each option with the derived one and its value', async () => {
    render(
      <OptionSelect
        label="Language"
        value="en"
        options={options}
        onChange={() => {}}
        testId="x.y.locale-select"
      />,
    )

    await userEvent.click(screen.getByTestId('x.y.locale-select'))

    const items = await screen.findAllByTestId('x.y.locale-select.option')

    expect(items.map((item) => item.getAttribute('data-value'))).toEqual(['en', 'es'])
  })

  it('carries the chosen value on its anchor', () => {
    const { rerender } = render(
      <OptionSelect
        label="Language"
        value="en"
        options={options}
        onChange={() => {}}
        testId="x.y.locale-select"
      />,
    )

    expect(screen.getByTestId('x.y.locale-select').getAttribute('data-value')).toBe('en')

    rerender(
      <OptionSelect
        label="Language"
        value="es"
        options={options}
        onChange={() => {}}
        testId="x.y.locale-select"
      />,
    )

    expect(screen.getByTestId('x.y.locale-select').getAttribute('data-value')).toBe('es')
  })

  it('reports the chosen option', async () => {
    const onChange = vi.fn()

    render(
      <OptionSelect
        label="Language"
        value="en"
        options={options}
        onChange={onChange}
        testId="x.y.locale-select"
      />,
    )

    await userEvent.click(screen.getByTestId('x.y.locale-select'))

    const spanish = (await screen.findAllByTestId('x.y.locale-select.option')).find(
      (item) => item.getAttribute('data-value') === 'es',
    ) as HTMLElement

    // The list takes no pointer until it has finished opening.
    await vi.waitFor(() => expect(getComputedStyle(spanish).pointerEvents).not.toBe('none'))
    await userEvent.click(spanish)

    expect(onChange).toHaveBeenCalledWith('es')
  })

  it('passes holdsInput to its select: a choice that applies at once holds no input', async () => {
    function Probe() {
      return <output data-testid="probe">{String(useUnsavedInput())}</output>
    }

    render(
      <UnsavedInputScope>
        <OptionSelect
          label="Language"
          value="en"
          options={options}
          onChange={() => {}}
          testId="x.y.locale-select"
          holdsInput={false}
        />
        <Probe />
      </UnsavedInputScope>,
    )

    await userEvent.click(screen.getByTestId('x.y.locale-select'))

    const spanish = (await screen.findAllByTestId('x.y.locale-select.option')).find(
      (item) => item.getAttribute('data-value') === 'es',
    ) as HTMLElement

    await vi.waitFor(() => expect(getComputedStyle(spanish).pointerEvents).not.toBe('none'))
    await userEvent.click(spanish)

    expect(screen.getByTestId('probe').textContent).toBe('false')
  })

  it('carries no anchor without a testId', async () => {
    render(<OptionSelect label="Language" value="en" options={options} onChange={() => {}} />)

    await userEvent.click(screen.getByRole('combobox'))
    await screen.findAllByRole('option')

    expect(document.querySelector('[data-testid]')).toBeNull()
  })
})
