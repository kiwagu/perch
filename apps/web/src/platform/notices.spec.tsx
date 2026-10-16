// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NoticeProvider, useNotice, useNotify } from './notices'

function Trigger(props: { readonly text: string }) {
  const notify = useNotify()

  return (
    <button type="button" onClick={() => notify({ testId: 'test.notice', text: props.text })}>
      {props.text}
    </button>
  )
}

function Current() {
  const notice = useNotice()

  return notice ? <p data-testid={notice.testId}>{notice.text}</p> : null
}

describe('notices', () => {
  it('shows the latest notice wherever the application renders it', () => {
    render(
      <NoticeProvider>
        <Trigger text="Saved" />
        <Trigger text="Welcome" />
        <Current />
      </NoticeProvider>,
    )

    expect(screen.queryByTestId('test.notice')).toBeNull()

    fireEvent.click(screen.getByText('Saved'))

    expect(screen.getByTestId('test.notice').textContent).toBe('Saved')

    fireEvent.click(screen.getByRole('button', { name: 'Welcome' }))

    expect(screen.getByTestId('test.notice').textContent).toBe('Welcome')
  })
})
