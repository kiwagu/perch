import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Form } from '@workspace/ui/components/ui/form'
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

type Pair = readonly [number, number]

/** A single select whose values are pairs, compared by their first element. */
function Pairs() {
  const [value, setValue] = useState<Pair | null>([1, 10])

  return (
    <Select<Pair>
      value={value}
      onValueChange={setValue}
      isItemEqualToValue={(item, chosen) => item[0] === chosen[0]}
      itemToStringLabel={(item) => `${item[0]}`}
    >
      <SelectTrigger aria-label="kind">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={[1, 10]}>Alpha</SelectItem>
        <SelectItem value={[2, 20]}>Beta</SelectItem>
      </SelectContent>
    </Select>
  )
}

/** An uncontrolled select of several choices, starting with none. */
function SeveralUncontrolled() {
  return (
    <Select items={ITEMS} multiple>
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

/** A select of kinds that starts with several choices and, on "one", turns single. */
function Switching() {
  const [several, setSeveral] = useState(true)
  const [value, setValue] = useState<Kind | readonly Kind[] | null>([])

  return (
    <>
      <Select<Kind, boolean>
        multiple={several}
        value={value}
        onValueChange={setValue}
        isItemEqualToValue={(item, chosen) => item.name.toLowerCase() === chosen.name.toLowerCase()}
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
      <button
        type="button"
        onClick={() => {
          setSeveral(false)
          setValue(KINDS[0] ?? null)
        }}
      >
        one
      </button>
    </>
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

  it('compares a single choice whole, even when its value is a list', async () => {
    render(
      <UnsavedInputScope>
        <Pairs />
        <Probe />
      </UnsavedInputScope>,
    )

    await choose('Beta')
    expect(probe()).toBe('true')
  })

  it('comes back clean when an uncontrolled multiple select is emptied again', async () => {
    render(
      <UnsavedInputScope>
        <SeveralUncontrolled />
        <Probe />
      </UnsavedInputScope>,
    )

    await choose('Beta')
    expect(probe()).toBe('true')

    const beta = screen.getByRole('option', { name: 'Beta' })

    await userEvent.click(beta)
    expect(probe()).toBe('false')
  })

  it('starts afresh when a select turns from several choices to one', async () => {
    render(
      <UnsavedInputScope>
        <Switching />
        <Probe />
      </UnsavedInputScope>,
    )

    await choose('Beta')
    expect(probe()).toBe('true')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByText('one'))
    expect(probe()).toBe('false')
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

  it('opens without an inline style, its scrollbar hidden by the kit stylesheet', async () => {
    render(<Controlled />)

    await userEvent.click(screen.getByLabelText('kind'))
    await screen.findByRole('option', { name: 'Beta' })

    // A strict style policy refuses an inline <style>; the class it would define is the kit's.
    expect(document.querySelectorAll('style')).toHaveLength(0)
    expect(document.querySelector('.base-ui-disable-scrollbar')).not.toBeNull()
  })
})

describe('the state a Select trigger shows on its own border', () => {
  const STORED = new Set(['x.kind-select'])

  function Marked(props: { readonly marksState?: boolean }) {
    const [value, setValue] = useState<string | null>('a')

    return (
      <UnsavedInputScope stores={(anchor) => STORED.has(anchor)}>
        <Form onSubmit={() => true}>
          <Select
            items={ITEMS}
            value={value}
            onValueChange={setValue}
            anchor="x.kind-select"
            marksState={props.marksState}
          >
            <SelectTrigger aria-label="kind" data-testid="x.kind-select">
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
          <button type="submit">save</button>
        </Form>
      </UnsavedInputScope>
    )
  }

  it('has no state untouched, unsaved once another is chosen, saved once a submit saved it', async () => {
    render(<Marked />)

    const trigger = screen.getByLabelText('kind')

    expect(trigger.hasAttribute('data-state')).toBe(false)
    await choose('Beta')
    expect(trigger.getAttribute('data-state')).toBe('unsaved')
    await userEvent.click(screen.getByText('save'))
    expect(trigger.getAttribute('data-state')).toBe('saved')
  })

  it('colors its border by the state, and loses the colors with marksState={false}, keeping data-state', async () => {
    const { rerender } = render(<Marked />)
    const trigger = screen.getByLabelText('kind')

    expect(trigger.className).toContain('data-[state=unsaved]:not-aria-invalid:border-warning')
    expect(trigger.className).toContain('data-[state=saved]:not-aria-invalid:border-success')
    expect(trigger.className).not.toMatch(/(^| )focus-visible:border-ring/)

    rerender(<Marked marksState={false} />)
    await choose('Beta')
    expect(trigger.className).not.toContain('border-warning')
    expect(trigger.className).toMatch(/(^| )focus-visible:border-ring/)
    expect(trigger.getAttribute('data-state')).toBe('unsaved')
  })
})
