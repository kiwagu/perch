// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ProfileId } from '@workspace/ids'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/user.en.json'
import es from '../../i18n/user.es.json'

import type { ProfileResult } from './profile.model.gen'
import { ProfileView, type ProfileViewProps } from './profile.view'

// The tree the profile shape returns, as its snapshot in the service test records it.
const tree: ProfileResult = [
  {
    id: 'prf_0000000000000000.01m52pexcp' as ProfileId,
    name: 'Ann',
    email: 'ann@example.test',
    bio: undefined,
    locale: undefined,
    created_at: new Date('2026-10-16T12:00:00Z'),
  },
]

function renderView(props: Partial<ProfileViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = { onSave: vi.fn(), onSignOut: vi.fn(), onCancelSignOut: vi.fn() }
  const view = (more: Partial<ProfileViewProps>) => (
    <ProfileView status="ready" profile={tree[0]} {...handlers} {...props} {...more} />
  )
  const { rerender } = renderWithProviders(view({}), { locale, es })

  return { ...handlers, rerender: (more: Partial<ProfileViewProps>) => rerender(view(more)) }
}

const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

describe('ProfileView', () => {
  it('shows the name and the email', () => {
    renderView()

    expect(screen.getByTestId('user.profile.heading').textContent).toBe('Ann')
    expect(field('user.profile.email').value).toBe('ann@example.test')
    expect(field('user.profile.name-input').value).toBe('Ann')
  })

  it('shows the bio under its label, empty while the profile has none', () => {
    renderView()

    expect(field('user.profile.bio-input').value).toBe('')
    expect(screen.getByLabelText(en['user.profile.bio'])).toBe(field('user.profile.bio-input'))
  })

  it('shows the stored bio', () => {
    renderView({ profile: { name: 'Ann', email: 'ann@example.test', bio: 'Hello' } })

    expect(field('user.profile.bio-input').value).toBe('Hello')
  })

  it('saves the new name', () => {
    const { onSave } = renderView()

    fireEvent.change(field('user.profile.name-input'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByTestId('user.profile.save'))

    expect(screen.getByTestId('user.profile.save').textContent).toBe(en['user.profile.save'])
    expect(onSave).toHaveBeenCalledWith({ name: 'Renamed', bio: '' })
  })

  it('saves the name and the bio with one Save', () => {
    const { onSave } = renderView()

    fireEvent.change(field('user.profile.name-input'), { target: { value: 'Renamed' } })
    fireEvent.change(field('user.profile.bio-input'), { target: { value: 'About me' } })
    fireEvent.click(screen.getByTestId('user.profile.save'))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith({ name: 'Renamed', bio: 'About me' })
  })

  it('restarts a draft when its stored value changes, here or on another device', () => {
    const profile = { name: 'Ann', email: 'ann@example.test', bio: 'Hello' }
    const { rerender } = renderView({ profile })

    fireEvent.change(field('user.profile.name-input'), { target: { value: 'Ann draft' } })
    fireEvent.change(field('user.profile.bio-input'), { target: { value: 'Bio draft' } })
    rerender({ profile: { ...profile, bio: 'Written elsewhere' } })

    expect(field('user.profile.bio-input').value).toBe('Written elsewhere')
    expect(field('user.profile.name-input').value).toBe('Ann draft')

    rerender({ profile: { ...profile, name: 'Bea', bio: 'Written elsewhere' } })

    expect(field('user.profile.name-input').value).toBe('Bea')

    // A stored value that comes back to an earlier one does not bring back the old draft.
    rerender({ profile: { ...profile, name: 'Bea' } })

    expect(field('user.profile.bio-input').value).toBe('Hello')
  })

  it('explains a name the profile refuses', () => {
    renderView({ error: 'profile:NAME_REQUIRED' })

    expect(screen.getByTestId('user.profile.error').textContent).toBe(
      en['user.profile.error.name-required'],
    )
    expect(field('user.profile.name-input').getAttribute('aria-invalid')).toBe('true')
  })

  it('explains a change that was not saved without blaming the name', () => {
    renderView({ error: 'data:WRITE_FAILED' })

    expect(screen.getByTestId('user.profile.error').textContent).toBe(
      en['user.profile.error.failed'],
    )
    expect(field('user.profile.name-input').getAttribute('aria-invalid')).toBeNull()
  })

  it('says when the profile is still loading or missing', () => {
    renderView({ status: 'loading', profile: undefined })

    expect(screen.getByTestId('user.profile.status').textContent).toBe(en['user.profile.loading'])
  })

  it('signs out', () => {
    const { onSignOut } = renderView()

    fireEvent.click(screen.getByTestId('user.profile.sign-out'))

    expect(onSignOut).toHaveBeenCalledOnce()
    expect(onSignOut).toHaveBeenCalledWith()
  })

  it('asks before signing out with changes this device has not sent', async () => {
    const { onSignOut, onCancelSignOut } = renderView({ confirmSignOut: true })

    expect((await screen.findByRole('alertdialog')).textContent).toContain(
      en['user.profile.sign-out-offline.title'],
    )
    expect(screen.getByRole('alertdialog').textContent).toContain(
      en['user.profile.sign-out-offline.body'],
    )
    expect(screen.getByTestId('user.profile.sign-out-offline.confirm').textContent).toBe(
      en['user.profile.sign-out-offline.confirm'],
    )

    fireEvent.click(screen.getByTestId('user.profile.sign-out-offline.confirm'))

    expect(onSignOut).toHaveBeenCalledWith({ forgetUnsent: true })

    fireEvent.click(screen.getByTestId('user.profile.sign-out-offline.cancel'))

    expect(onCancelSignOut).toHaveBeenCalledOnce()
  })

  it('shows no confirmation until signing out needs one', () => {
    renderView()

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByTestId('user.profile.sign-out-offline.confirm')).toBeNull()
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByTestId('user.profile.save').textContent).toBe(es['user.profile.save'])
    expect(screen.getByLabelText(es['user.profile.bio'])).toBe(field('user.profile.bio-input'))
  })
})
