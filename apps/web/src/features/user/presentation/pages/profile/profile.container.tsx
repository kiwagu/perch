import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useLocale, useT } from '@workspace/i18n'

import { useSetLocale } from '../../../../../platform/i18n'
import { useService, useShape } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { SIGN_IN_PATH } from '../../../../../platform/router'
import { SESSION } from '../../../../../platform/session.port'
import { localeChange, PROFILE_SERVICE } from '../../../application/profile.service'

import { profileShape } from './profile.model.gen'
import { ProfileView } from './profile.view'

export function ProfileContainer() {
  const session = useService(SESSION)
  const profiles = useService(PROFILE_SERVICE)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const { tree, status } = useShape(profileShape, user ? { user: user.id } : null)
  const row = tree?.[0]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
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

  const saveName = (name: string) => {
    if (!row) {
      return
    }

    setSaving(true)
    void profiles
      .updateName({ id: row.id, name })
      .match(
        () => {
          setError(undefined)
          notify({ testId: 'user.profile.notice', text: t('user.profile.saved') })
        },
        (failure) => setError(failure.code),
      )
      .then(() => setSaving(false))
  }

  const signOut = () => {
    void session.signOut().match(
      () => navigate({ to: SIGN_IN_PATH }),
      () => navigate({ to: SIGN_IN_PATH }),
    )
  }

  return (
    <ProfileView
      status={status}
      profile={row}
      saving={saving}
      error={error}
      onSaveName={saveName}
      onSignOut={signOut}
    />
  )
}
