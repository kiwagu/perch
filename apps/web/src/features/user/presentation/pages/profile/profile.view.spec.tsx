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
  const handlers = { onSaveName: vi.fn(), onSignOut: vi.fn() }

  renderWithProviders(<ProfileView status="ready" profile={tree[0]} {...handlers} {...props} />, {
    locale,
    es,
  })

  return handlers
}

describe('ProfileView', () => {
  it('shows the name and the email', () => {
    renderView()

    expect(screen.getByTestId('user.profile.heading').textContent).toBe('Ann')
    expect((screen.getByTestId('user.profile.email') as HTMLInputElement).value).toBe(
      'ann@example.test',
    )
    expect((screen.getByTestId('user.profile.name-input') as HTMLInputElement).value).toBe('Ann')
  })

  it('saves the new name', () => {
    const { onSaveName } = renderView()

    fireEvent.change(screen.getByTestId('user.profile.name-input'), {
      target: { value: 'Renamed' },
    })
    fireEvent.click(screen.getByTestId('user.profile.save'))

    expect(screen.getByTestId('user.profile.save').textContent).toBe(en['user.profile.save'])
    expect(onSaveName).toHaveBeenCalledWith('Renamed')
  })

  it('explains a name the profile refuses', () => {
    renderView({ error: 'profile:NAME_REQUIRED' })

    expect(screen.getByTestId('user.profile.error').textContent).toBe(
      en['user.profile.error.name-required'],
    )
  })

  it('says when the profile is still loading or missing', () => {
    renderView({ status: 'loading', profile: undefined })

    expect(screen.getByTestId('user.profile.status').textContent).toBe(en['user.profile.loading'])
  })

  it('signs out', () => {
    const { onSignOut } = renderView()

    fireEvent.click(screen.getByTestId('user.profile.sign-out'))

    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByTestId('user.profile.save').textContent).toBe(es['user.profile.save'])
  })
})
