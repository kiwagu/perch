// @vitest-environment jsdom
import { join } from 'node:path'

import { cleanup, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ProfileId } from '@workspace/ids'
import { loadScreens } from '@workspace/ui-contract'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/user.en.json'
import es from '../../i18n/user.es.json'

import type { ProfileResult } from './profile.model.gen'
import { type ProfileControl, ProfileView, type ProfileViewProps } from './profile.view'

const ROOT = join(import.meta.dirname, '../../../../../../../..')

// The tree the profile shape returns, as its snapshot in the service test records it.
const tree: ProfileResult = [
  {
    id: 'prf_0000000000000000.01m52pexcp' as ProfileId,
    name: 'Ann',
    email: 'ann@example.test',
    bio: undefined,
    created_at: new Date('2026-10-16T12:00:00Z'),
  },
]

function renderView(props: Partial<ProfileViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = {
    onType: vi.fn(),
    onSave: vi.fn(),
    onSignOut: vi.fn(),
    onConfirmSignOut: vi.fn(),
    onCancelSignOut: vi.fn(),
  }
  const view = (more: Partial<ProfileViewProps>) => (
    <ProfileView
      status="ready"
      profile={tree[0]}
      form={{ name: 'Ann', bio: '' }}
      can={() => true}
      {...handlers}
      {...props}
      {...more}
    />
  )
  const { rerender } = renderWithProviders(view({}), { locale, es })

  return { ...handlers, rerender: (more: Partial<ProfileViewProps>) => rerender(view(more)) }
}

const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

/** The form field an element sits in: its label, its control and the error that concerns it. */
const fieldOf = (testId: string) => screen.getByTestId(testId).closest('[data-slot="field"]')

/** A domain code the view maps to each contract code of the error. */
const DOMAIN: Readonly<Record<string, string>> = {
  'name-required': 'profile:NAME_REQUIRED',
  'name-too-long': 'profile:NAME_TOO_LONG',
  'bio-too-long': 'profile:BIO_TOO_LONG',
}

describe('ProfileView', () => {
  it('shows the stored name and email, and what the fields show', () => {
    renderView({ form: { name: 'Ann draft', bio: 'About me' } })

    expect(screen.getByTestId('user.profile.form').tagName).toBe('FORM')
    expect(screen.getByTestId('user.profile.heading').textContent).toBe('Ann')
    expect(field('user.profile.email-input').value).toBe('ann@example.test')
    expect(field('user.profile.name-input').value).toBe('Ann draft')
    expect(field('user.profile.bio-textarea').value).toBe('About me')
    expect(screen.getByLabelText(en['user.profile.bio'])).toBe(field('user.profile.bio-textarea'))
  })

  it('tells what is typed into each field, and Save', () => {
    const { onType, onSave } = renderView()

    fireEvent.change(field('user.profile.name-input'), { target: { value: 'Renamed' } })
    fireEvent.change(field('user.profile.bio-textarea'), { target: { value: 'About me' } })
    fireEvent.click(screen.getByTestId('user.profile.save-button'))

    expect(onType).toHaveBeenCalledWith('name', 'Renamed')
    expect(onType).toHaveBeenCalledWith('bio', 'About me')
    expect(onSave).toHaveBeenCalledOnce()
    expect(screen.getByTestId('user.profile.save-button').textContent).toBe(en['user.profile.save'])
  })

  it('enables each button while the flow handles it', () => {
    const { onSave, rerender } = renderView({
      can: (control: ProfileControl) => control === 'user.profile.sign-out-button',
    })
    const save = screen.getByTestId('user.profile.save-button') as HTMLButtonElement
    const signOut = screen.getByTestId('user.profile.sign-out-button') as HTMLButtonElement

    expect(save.disabled).toBe(true)
    expect(signOut.disabled).toBe(false)

    fireEvent.click(save)

    expect(onSave).not.toHaveBeenCalled()

    rerender({ can: (control: ProfileControl) => control === 'user.profile.save-button' })

    expect(save.disabled).toBe(false)
    expect(signOut.disabled).toBe(true)
  })

  it("shows an error under the field its code concerns, as the screen's fields say", () => {
    const { screens } = loadScreens(ROOT)
    const fields = screens?.screens.find(({ id }) => id === 'user.profile')?.anchors[
      'user.profile.error'
    ]?.fields

    expect(Object.keys(fields ?? {}).length).toBeGreaterThan(0)

    for (const [code, anchor] of Object.entries(fields ?? {})) {
      renderView({ error: DOMAIN[code] })

      expect(screen.getByTestId('user.profile.error').getAttribute('data-code')).toBe(code)
      expect(fieldOf('user.profile.error')).toBe(fieldOf(anchor))
      expect(field(anchor).getAttribute('aria-invalid')).toBe('true')

      cleanup()
    }
  })

  it('explains each refused save, and shows a failure that concerns no field above Save', () => {
    const { rerender } = renderView({ error: 'profile:NAME_REQUIRED' })

    expect(screen.getByTestId('user.profile.error').textContent).toBe(
      en['user.profile.error.name-required'],
    )

    rerender({ error: 'profile:BIO_TOO_LONG' })

    expect(field('user.profile.bio-textarea').maxLength).toBe(2000)
    expect(screen.getByTestId('user.profile.error').textContent).toBe(
      en['user.profile.error.bio-too-long'],
    )

    rerender({ error: 'data:WRITE_FAILED' })

    expect(screen.getByTestId('user.profile.error').getAttribute('data-code')).toBe('failed')
    expect(screen.getByTestId('user.profile.error').textContent).toBe(
      en['user.profile.error.failed'],
    )
    expect(fieldOf('user.profile.error')).toBe(fieldOf('user.profile.save-button'))
    expect(field('user.profile.name-input').getAttribute('aria-invalid')).toBeNull()
  })

  it('says when the profile is still loading or missing', () => {
    const { rerender } = renderView({ status: 'loading', profile: undefined })

    expect(screen.getByTestId('user.profile.status').getAttribute('data-state')).toBe('loading')
    expect(screen.getByTestId('user.profile.status').textContent).toBe(en['user.profile.loading'])

    rerender({ status: 'ready', profile: undefined })

    expect(screen.getByTestId('user.profile.status').getAttribute('data-state')).toBe('empty')
    expect(screen.getByTestId('user.profile.status').textContent).toBe(en['user.profile.missing'])
  })

  it('signs out', () => {
    const { onSignOut } = renderView()

    fireEvent.click(screen.getByTestId('user.profile.sign-out-button'))

    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('asks before signing out with changes this device has not sent', async () => {
    const { onConfirmSignOut, onCancelSignOut } = renderView({ confirmSignOut: true })

    const dialog = await screen.findByTestId('user.profile.sign-out-dialog')

    expect(dialog.getAttribute('data-code')).toBe('unsent-changes')
    expect(screen.getByRole('alertdialog')).toBe(dialog)
    expect(dialog.textContent).toContain(en['user.profile.sign-out-offline.title'])
    expect(dialog.textContent).toContain(en['user.profile.sign-out-offline.body'])
    expect(screen.getByTestId('user.profile.sign-out-dialog.confirm-button').textContent).toBe(
      en['user.profile.sign-out-offline.confirm'],
    )

    fireEvent.click(screen.getByTestId('user.profile.sign-out-dialog.confirm-button'))

    expect(onConfirmSignOut).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByTestId('user.profile.sign-out-dialog.cancel-button'))

    expect(onCancelSignOut).toHaveBeenCalled()
  })

  it('shows no confirmation until the flow asks', () => {
    renderView()

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByTestId('user.profile.sign-out-dialog.confirm-button')).toBeNull()
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByTestId('user.profile.save-button').textContent).toBe(es['user.profile.save'])
    expect(screen.getByLabelText(es['user.profile.bio'])).toBe(field('user.profile.bio-textarea'))
  })
})
