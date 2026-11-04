import { describe, expect, it, vi } from 'vitest'

import { routeFrameEffect } from './frame-effects'

const channels = () => ({
  notify: vi.fn(),
  clear: vi.fn(),
  pushToast: vi.fn(),
  leaveSignInNotice: vi.fn(),
})

describe('routeFrameEffect', () => {
  it('pushes a toast, sets the notice, and clears it', () => {
    const into = channels()

    routeFrameEffect({ type: 'show', anchor: 'app-shell.toast', codes: ['note-created'] }, into)
    routeFrameEffect({ type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] }, into)
    routeFrameEffect({ type: 'clear', anchor: 'app-shell.notice-message' }, into)

    expect(into.pushToast).toHaveBeenCalledWith('note-created')
    expect(into.notify).toHaveBeenCalledWith('welcome')
    expect(into.clear).toHaveBeenCalledTimes(1)
  })

  it("leaves the sign-in page's notice for the next sign-in page", () => {
    const into = channels()

    routeFrameEffect(
      { type: 'show', anchor: 'user.sign-in.notice-message', codes: ['password-reset-elsewhere'] },
      into,
    )

    expect(into.leaveSignInNotice).toHaveBeenCalledWith('password-reset-elsewhere')
    expect(into.notify).not.toHaveBeenCalled()
  })

  it('refuses a code the sign-in page does not say', () => {
    expect(() =>
      routeFrameEffect(
        { type: 'show', anchor: 'user.sign-in.notice-message', codes: ['welcome'] },
        channels(),
      ),
    ).toThrow('the sign-in page says no welcome')
  })

  it("leaves a screen's own anchors to its container", () => {
    const into = channels()

    routeFrameEffect(
      { type: 'show', anchor: 'organisation.notes.error', codes: ['forbidden', 'failed'] },
      into,
    )
    routeFrameEffect({ type: 'clear', anchor: 'organisation.notes.error' }, into)
    routeFrameEffect({ type: 'navigate', to: '/sign-in' }, into)

    expect(into.pushToast).not.toHaveBeenCalled()
    expect(into.notify).not.toHaveBeenCalled()
    expect(into.clear).not.toHaveBeenCalled()
    expect(into.leaveSignInNotice).not.toHaveBeenCalled()
  })

  it('refuses a frame show of several codes: the machine narrows it first', () => {
    expect(() =>
      routeFrameEffect(
        { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome', 'change-rejected'] },
        channels(),
      ),
    ).toThrow('a show on app-shell.notice-message carries one code, not welcome, change-rejected')
  })
})
