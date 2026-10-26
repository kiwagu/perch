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

/** Opens the select and chooses the option named `name`. */
async function choose(name: string): Promise<void> {
  await userEvent.click(screen.getByLabelText('kind'))

  const option = await screen.findByRole('option', { name })

  // The list takes no pointer until it has finished opening.
  await vi.waitFor(() => expect(getComputedStyle(option).pointerEvents).not.toBe('none'))
  await userEvent.click(option)
}

const chooseBeta = () => choose('Beta')

interface Kind {
  readonly id: number
  readonly name: string
}

const KINDS: readonly Kind[] = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
]

/** A select of objects, each a choice of its own, compared by id as the app's data would be. */
function Objects() {
  const [value, setValue] = useState<Kind | null>({ id: 1, name: 'Alpha' })

  return (
    <Select
      value={value}
      onValueChange={setValue}
      isItemEqualToValue={(item, chosen) => item.id === chosen.id}
      itemToStringLabel={(item) => item.name}
    >
      <SelectTrigger aria-label="kind">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {KINDS.map((kind) => (
          <SelectItem key={kind.id} value={kind}>
            {kind.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A select of several choices at once. */
function Several() {
  const [values, setValues] = useState<string[]>(['a'])

  return (
    <Select items={ITEMS} multiple value={values} onValueChange={setValues}>
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

  it('tells object choices apart by the comparison the select is given', async () => {
    render(
      <UnsavedInputScope>
        <Objects />
        <Probe />
      </UnsavedInputScope>,
    )

    await choose('Beta')
    expect(probe()).toBe('true')
    await userEvent.keyboard('{Escape}')
    await choose('Alpha')
    expect(probe()).toBe('false')
  })

  it('takes several choices at once, and holds unsaved input once they change', async () => {
    render(
      <UnsavedInputScope>
        <Several />
        <Probe />
      </UnsavedInputScope>,
    )

    await choose('Beta')
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
