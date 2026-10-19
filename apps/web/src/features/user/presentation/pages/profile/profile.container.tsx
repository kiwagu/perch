import { useNavigate } from '@tanstack/react-router'
import { okAsync } from 'neverthrow'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { BusError } from '@workspace/cqrs'
import { useLocale, useT } from '@workspace/i18n'

import { useSetLocale } from '../../../../../platform/i18n'
import { useService, useShape } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { SIGN_IN_PATH } from '../../../../../platform/router'
import { SESSION } from '../../../../../platform/session.port'
import { localeChange } from '../../../application/locale-change.policy'
import { PROFILE_SERVICE } from '../../../application/profile.service'

import { profileShape } from './profile.model.gen'
import { type ProfileDraft, ProfileView } from './profile.view'

export function ProfileContainer() {
  const session = useService(SESSION)
  const profiles = useService(PROFILE_SERVICE)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const { tree, status } = useShape(profileShape, user ? { identity: user.id } : null)
  const row = tree?.[0]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const notify = useNotify()
  const navigate = useNavigate()
  const t = useT()
  const locale = useLocale()
  const setLocale = useSetLocale()
  const seen = useRef<string | undefined>(undefined)

  // The language follows the profile across devices; see `localeChange`.
  useEffect(() => {
    if (!row) {
      return
    }

    const change = localeChange({
      stored: row.locale,
      current: locale,
      first: seen.current !== row.id,
    })

    seen.current = row.id

    if (change && 'apply' in change) {
      setLocale(change.apply)
    } else if (change) {
      void profiles.updateLocale({ id: row.id, locale: change.save }).match(
        () => undefined,
        (failure) => setError(failure.code),
      )
    }
  }, [row, locale, setLocale, profiles])

  // One Save writes each field the person changed: the name first, then the bio.
  const save = (draft: ProfileDraft) => {
    if (!row) {
      return
    }

    const name = () =>
      draft.name === row.name
        ? okAsync<void, BusError>(undefined)
        : profiles.updateName({ id: row.id, name: draft.name })
    const bio = () =>
      draft.bio === (row.bio ?? '')
        ? okAsync<void, BusError>(undefined)
        : profiles.updateBio({ id: row.id, bio: draft.bio })

    setSaving(true)
    void name()
      .andThen(bio)
      .match(
        () => {
          setError(undefined)
          notify({ testId: 'user.profile.notice', text: t('user.profile.saved') })
        },
        (failure) => setError(failure.code),
      )
      .then(() => setSaving(false))
  }

  // Changes this device could not send are lost by signing out: that waits for a confirmation.
  const signOut = (options?: { readonly forgetUnsent: true }) => {
    setConfirmSignOut(false)
    void session.signOut(options).match(
      (outcome) =>
        outcome === 'needs-confirmation'
          ? setConfirmSignOut(true)
          : void navigate({ to: SIGN_IN_PATH }),
      () => navigate({ to: SIGN_IN_PATH }),
    )
  }

  return (
    <ProfileView
      status={status}
      profile={row}
      saving={saving}
      error={error}
      onSave={save}
      onSignOut={signOut}
      confirmSignOut={confirmSignOut}
      onCancelSignOut={() => setConfirmSignOut(false)}
    />
  )
}
