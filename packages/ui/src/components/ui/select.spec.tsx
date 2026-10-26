import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/ui/select'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

const ITEMS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
]

function Probe() {
  return <output data-testid="probe">{String(useUnsavedInput())}</output>
}

/** A controlled select as the app renders one: it echoes the choice. */
function Controlled(props: { readonly holdsInput?: boolean }) {
  const [value, setValue] = useState<string | null>('a')

  return (
    <Select items={ITEMS} value={value} onValueChange={setValue} holdsInput={props.holdsInput}>
      <SelectTrigger aria-label="kind">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Opens the select and chooses Beta. */
async function chooseBeta(): Promise<void> {
  await userEvent.click(screen.getByLabelText('kind'))

  const beta = await screen.findByRole('option', { name: 'Beta' })

  // The list takes no pointer until it has finished opening.
  await vi.waitFor(() => expect(getComputedStyle(beta).pointerEvents).not.toBe('none'))
  await userEvent.click(beta)
}

const probe = () => screen.getByTestId('probe').textContent

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('Select', () => {
  it('holds unsaved input once another option is chosen', async () => {
    render(
      <UnsavedInputScope>
        <Controlled />
        <Probe />
      </UnsavedInputScope>,
    )

    expect(probe()).toBe('false')
    await chooseBeta()
    expect(probe()).toBe('true')
  })

  it('never holds unsaved input when holdsInput is false', async () => {
    render(
      <UnsavedInputScope>
        <Controlled holdsInput={false} />
        <Probe />
      </UnsavedInputScope>,
    )

    await chooseBeta()
    expect(probe()).toBe('false')
  })
})
