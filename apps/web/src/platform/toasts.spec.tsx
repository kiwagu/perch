// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TOAST_LIFETIME_MS,
  ToastProvider,
  useDismissToast,
  usePushToast,
  useToasts,
} from './toasts'

const TEXTS = { 'note-created': () => 'Note added', 'note-deleted': () => 'Note deleted' }

let push: (code: string) => void = () => {}
let dismiss: (id: number) => void = () => {}

function Probe() {
  push = usePushToast()
  dismiss = useDismissToast()

  return (
    <ol>
      {useToasts().map((toast) => (
        <li key={toast.id} data-testid="toast" data-code={toast.code} data-id={toast.id} />
      ))}
    </ol>
  )
}

const codes = () => screen.queryAllByTestId('toast').map((toast) => toast.getAttribute('data-code'))

describe('the toast channel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    render(
      <ToastProvider texts={TEXTS}>
        <Probe />
      </ToastProvider>,
    )
  })

  afterEach(() => vi.useRealTimers())

  it('stacks the newest at the top, and lets each go after its lifetime', () => {
    act(() => {
      push('note-created')
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    act(() => {
      push('note-deleted')
    })

    expect(codes()).toEqual(['note-deleted', 'note-created'])

    act(() => {
      vi.advanceTimersByTime(TOAST_LIFETIME_MS - 1_000)
    })

    expect(codes()).toEqual(['note-deleted'])

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(codes()).toEqual([])
  })

  it('dismisses one toast by its id', () => {
    act(() => {
      push('note-created')
    })
    act(() => {
      push('note-created')
    })

    const [newest] = screen.getAllByTestId('toast')

    act(() => {
      dismiss(Number(newest?.getAttribute('data-id')))
    })

    expect(codes()).toEqual(['note-created'])
  })

  it('refuses a code the frame gives no words', () => {
    expect(() => push('bio-updated')).toThrow('the toast has no text for the code bio-updated')
  })
})
