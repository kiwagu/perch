// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'

import type { Translate } from '@workspace/i18n'

import { NoticeProvider, useClearNotice, useNotice, useNotify } from './notices'

/** The words of the codes these tests raise. */
const TEXTS = {
  'change-rejected': () => 'Undone',
  welcome: () => 'Welcome',
  'changes-reloaded': () => 'Reloaded',
}

function Trigger(props: { readonly code: string; readonly text: string }) {
  const notify = useNotify()

  return (
    <button type="button" onClick={() => notify(props.code)}>
      {props.text}
    </button>
  )
}

const asWritten: Translate = (key) => key

function Current() {
  const notice = useNotice()

  return notice ? <p data-code={notice.code}>{notice.text(asWritten)}</p> : null
}

describe('notices', () => {
  it('shows the latest notice wherever the application renders it', () => {
    render(
      <NoticeProvider texts={TEXTS}>
        <Trigger code="change-rejected" text="Undone" />
        <Trigger code="welcome" text="Welcome" />
        <Current />
      </NoticeProvider>,
    )

    expect(document.querySelector('[data-code]')).toBeNull()

    fireEvent.click(screen.getByText('Undone'))

    expect(document.querySelector('[data-code]')?.getAttribute('data-code')).toBe('change-rejected')
    expect(document.querySelector('[data-code]')?.textContent).toBe('Undone')

    fireEvent.click(screen.getByRole('button', { name: 'Welcome' }))

    expect(document.querySelector('[data-code]')?.getAttribute('data-code')).toBe('welcome')
    expect(document.querySelector('[data-code]')?.textContent).toBe('Welcome')
  })

  it('shows no notice once it is cleared, until a newer one is raised', () => {
    function Clear() {
      const clear = useClearNotice()

      return (
        <button type="button" onClick={clear}>
          clear
        </button>
      )
    }

    render(
      <NoticeProvider texts={TEXTS}>
        <Trigger code="change-rejected" text="Undone" />
        <Clear />
        <Current />
      </NoticeProvider>,
    )

    fireEvent.click(screen.getByText('Undone'))
    fireEvent.click(screen.getByText('clear'))

    expect(document.querySelector('[data-code]')).toBeNull()

    fireEvent.click(screen.getByText('Undone'))

    expect(document.querySelector('[data-code]')?.getAttribute('data-code')).toBe('change-rejected')
  })

  it('drops a notice raised for what came before the clear, such as a reply that came late', () => {
    function Late() {
      const notify = useNotify()
      // The page's request went out before the clear; its reply arrives after it.
      const first = useRef(notify)

      return (
        <button type="button" onClick={() => first.current('changes-reloaded')}>
          late
        </button>
      )
    }

    function Clear() {
      const clear = useClearNotice()

      return (
        <button type="button" onClick={clear}>
          clear
        </button>
      )
    }

    render(
      <NoticeProvider texts={TEXTS}>
        <Late />
        <Trigger code="welcome" text="Welcome" />
        <Clear />
        <Current />
      </NoticeProvider>,
    )

    fireEvent.click(screen.getByText('clear'))
    fireEvent.click(screen.getByText('late'))

    expect(document.querySelector('[data-code]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Welcome' }))

    expect(document.querySelector('[data-code]')?.getAttribute('data-code')).toBe('welcome')
  })

  it('refuses a code the frame gives no words', () => {
    let raise: (code: string) => void = () => {}

    function Grab() {
      raise = useNotify()

      return null
    }

    render(
      <NoticeProvider texts={TEXTS}>
        <Grab />
      </NoticeProvider>,
    )

    expect(() => raise('lost')).toThrow('the notice has no text for the code lost')
  })
})
