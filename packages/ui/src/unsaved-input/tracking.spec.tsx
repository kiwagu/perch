import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Form } from '@workspace/ui/components/ui/form'

import { UnsavedInputScope, useStoresValue, useTracksInput, useUnsavedInput } from '.'

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('useTracksInput', () => {
  it('keeps a default that is a function as the value, never calling it', () => {
    const defaultValue = () => 'called'
    const { result } = renderHook(
      () => {
        useTracksInput({ holdsInput: true, anchor: undefined, value: undefined, defaultValue })

        return useUnsavedInput()
      },
      { wrapper: UnsavedInputScope },
    )

    expect(result.current).toBe(false)
  })
})

const STORED = 'x.y.name-input'

/** A text field that tracks itself and shows its state; the app gives `app`, and takes what is typed. */
function Field(props: {
  readonly app: string
  readonly anchor: string | undefined
  readonly holdsInput?: boolean
}) {
  const [value, setValue] = useState(props.app)
  const [given, setGiven] = useState(props.app)

  if (props.app !== given) {
    setGiven(props.app)
    setValue(props.app)
  }

  const { typed, state } = useTracksInput({
    holdsInput: props.holdsInput ?? true,
    anchor: props.anchor,
    value,
    defaultValue: '',
  })

  return (
    <>
      <input
        aria-label="name"
        value={value}
        onChange={(event) => {
          typed(event.target.value)
          setValue(event.target.value)
        }}
      />
      <output data-testid="state">{state ?? 'none'}</output>
    </>
  )
}

interface PageProps {
  readonly app: string
  readonly anchor?: string | undefined
  readonly stores?: ((anchor: string) => boolean) | undefined
  readonly holdsInput?: boolean
  readonly onSubmit?: () => Promise<boolean>
}

const storesName = (anchor: string): boolean => anchor === STORED

function Page(props: PageProps) {
  return (
    <UnsavedInputScope stores={'stores' in props ? props.stores : storesName}>
      <Form onSubmit={props.onSubmit ?? (() => Promise.resolve(true))}>
        <Field
          app={props.app}
          anchor={'anchor' in props ? props.anchor : STORED}
          holdsInput={props.holdsInput ?? true}
        />
        <button type="submit">save</button>
      </Form>
    </UnsavedInputScope>
  )
}

const state = () => screen.getByTestId('state').textContent
const name = () => screen.getByLabelText('name')

/** Types `more` into the field and saves it, waiting for the save to land. */
const typeAndSave = async (user: ReturnType<typeof userEvent.setup>, more: string) => {
  await user.type(name(), more)
  await user.click(screen.getByText('save'))
  await act(async () => {})
}

describe('useTracksInput state', () => {
  it('is unsaved while the value differs from the last one the app gave', async () => {
    const user = userEvent.setup()

    render(<Page app="Ann" />)
    expect(state()).toBe('none')

    await user.type(name(), 'a')
    expect(state()).toBe('unsaved')

    await user.type(name(), '{backspace}')
    expect(state()).toBe('none')
  })

  it("is saved once a submit that saved took what it shows, and keeps the app's echo of it", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Page app="Ann" />)

    await typeAndSave(user, 'a')
    expect(state()).toBe('saved')

    rerender(<Page app="Anna" />)
    expect(state()).toBe('saved')
  })

  it('loses saved when the app gives another value', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Page app="Ann" />)

    await typeAndSave(user, 'a')
    rerender(<Page app="Bob" />)
    expect(state()).toBe('none')

    // Cleared, not hidden: the app giving the saved value again does not bring it back. (Typed
    // first, so the app's "Anna" is not taken as the echo of the field's own last change.)
    await user.type(name(), 'x')
    rerender(<Page app="Anna" />)
    expect(state()).toBe('none')
  })

  it('typing again is unsaved, and typing back to the saved value is saved', async () => {
    const user = userEvent.setup()

    render(<Page app="Ann" />)
    await typeAndSave(user, 'a')

    await user.type(name(), 'b')
    expect(state()).toBe('unsaved')

    await user.type(name(), '{backspace}')
    expect(state()).toBe('saved')
  })

  it('text typed during the save stays unsaved', async () => {
    const user = userEvent.setup()
    const settles: Array<(saved: boolean) => void> = []
    const onSubmit = () =>
      new Promise<boolean>((settle) => {
        settles.push(settle)
      })

    render(<Page app="Ann" onSubmit={onSubmit} />)
    await user.type(name(), 'a')
    await user.click(screen.getByText('save'))
    await user.type(name(), 'b')
    await act(async () => settles[0]?.(true))

    expect(state()).toBe('unsaved')
  })

  it('a submit that saved nothing marks nothing', async () => {
    const user = userEvent.setup()

    render(<Page app="Ann" onSubmit={() => Promise.resolve(false)} />)
    await typeAndSave(user, 'a')

    expect(state()).toBe('unsaved')
  })

  it("never saved without the scope's stores, for an anchor it does not store, or without an anchor", async () => {
    const user = userEvent.setup()
    const pages = [
      <Page key="no-stores" app="Ann" stores={undefined} />,
      <Page key="not-stored" app="Ann" anchor="x.y.other-input" />,
      <Page key="no-anchor" app="Ann" anchor={undefined} />,
    ]

    for (const page of pages) {
      const { unmount } = render(page)

      await typeAndSave(user, 'a')
      expect(state()).toBe('none')
      unmount()
    }
  })

  it('a field that runs its own action has no state', async () => {
    const user = userEvent.setup()

    render(<Page app="Ann" holdsInput={false} />)
    await user.type(name(), 'a')
    expect(state()).toBe('none')

    await user.click(screen.getByText('save'))
    await act(async () => {})
    expect(state()).toBe('none')
  })

  it('a remount starts with no state', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Page key="first" app="Ann" />)

    await typeAndSave(user, 'a')
    expect(state()).toBe('saved')

    rerender(<Page key="second" app="Anna" />)
    expect(state()).toBe('none')
  })
})

describe('useStoresValue', () => {
  it('answers what the scope stores, and false without a predicate or outside a scope', () => {
    const asks = (wrapper?: (props: { readonly children: ReactNode }) => ReactNode) =>
      renderHook(() => useStoresValue()(STORED), wrapper === undefined ? {} : { wrapper }).result
        .current

    expect(
      asks(({ children }) => <UnsavedInputScope stores={storesName}>{children}</UnsavedInputScope>),
    ).toBe(true)
    expect(
      asks(({ children }) => (
        <UnsavedInputScope stores={() => false}>{children}</UnsavedInputScope>
      )),
    ).toBe(false)
    expect(asks(({ children }) => <UnsavedInputScope>{children}</UnsavedInputScope>)).toBe(false)
    expect(asks()).toBe(false)
  })
})
