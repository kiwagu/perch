// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Translate } from '@workspace/i18n'

import { NoticeProvider, useClearNotice, useNotice, useNotify } from './notices'

function Trigger(props: { readonly code: string; readonly text: string }) {
  const notify = useNotify()

  return (
    <button type="button" onClick={() => notify({ code: props.code, text: () => props.text })}>
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
      <NoticeProvider>
        <Trigger code="profile-saved" text="Saved" />
        <Trigger code="welcome" text="Welcome" />
        <Current />
      </NoticeProvider>,
    )

    expect(document.querySelector('[data-code]')).toBeNull()

    fireEvent.click(screen.getByText('Saved'))

    expect(document.querySelector('[data-code]')?.getAttribute('data-code')).toBe('profile-saved')
    expect(document.querySelector('[data-code]')?.textContent).toBe('Saved')

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
      <NoticeProvider>
        <Trigger code="profile-saved" text="Saved" />
        <Clear />
        <Current />
      </NoticeProvider>,
    )

    fireEvent.click(screen.getByText('Saved'))
    fireEvent.click(screen.getByText('clear'))

    expect(document.querySelector('[data-code]')).toBeNull()

    fireEvent.click(screen.getByText('Saved'))

    expect(document.querySelector('[data-code]')?.getAttribute('data-code')).toBe('profile-saved')
  })
})
