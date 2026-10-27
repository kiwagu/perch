import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { useService, useShape } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import {
  createProfileMachine,
  type ProfileFields,
  type ProfileValues,
} from '../../../application/profile.machine'
import { PROFILE_SERVICE } from '../../../application/profile.service'

import { profileShape } from './profile.model.gen'
import { type ProfileControl, ProfileView } from './profile.view'

/** The anchor whose event a field's typing is. */
const INPUTS = { name: 'user.profile.name-input', bio: 'user.profile.bio-textarea' } as const

export function ProfileContainer() {
  const session = useService(SESSION)
  const profiles = useService(PROFILE_SERVICE)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const { tree, status } = useShape(profileShape, user ? { identity: user.id } : null)
  const row = tree?.[0]
  const stored: ProfileFields = { name: row?.name ?? '', bio: row?.bio ?? '' }
  const [drafts, setDrafts] = useState<ProfileFields>(stored)
  // What the machine reads at each guard and each write: the profile as stored, what was typed.
  const values = useRef<ProfileValues>({ id: row?.id, stored, drafts })

  values.current = { id: row?.id, stored, drafts: values.current.drafts }

  const machine = useMemo(
    () =>
      createProfileMachine({
        profiles,
        signOut: (options) => session.signOut(options),
        values: () => values.current,
      }),
    [profiles, session],
  )
  const { state, send, submit, actor } = useScreenMachine(machine)
  const notify = useNotify()

  // The stored fields changed, here or on another device: the data events of the flow.
  useEffect(() => {
    if (row) {
      send({ type: 'model.profile.name' })
    }
  }, [row?.name, send])
  useEffect(() => {
    if (row) {
      send({ type: 'model.profile.bio' })
    }
  }, [row?.bio, send])

  // The effects of the flow outside the form: the shell's notice (the hook runs the moves).
  useEffect(() => {
    const shown = actor.on('show', ({ codes }) => {
      if (codes.includes('profile-saved')) {
        notify({ code: 'profile-saved', text: (t) => t('user.profile.saved') })
      }
    })

    return () => shown.unsubscribe()
  }, [actor, notify])

  const type = (field: keyof ProfileFields, value: string) => {
    const next = { ...values.current.drafts, [field]: value }

    values.current = { ...values.current, drafts: next }
    setDrafts(next)
    send({ type: INPUTS[field] })
  }

  return (
    <ProfileView
      status={status}
      profile={row}
      form={{
        name: state.context.edited.name ? drafts.name : stored.name,
        bio: state.context.edited.bio ? drafts.bio : stored.bio,
      }}
      error={state.context.error}
      can={(control: ProfileControl) => state.can({ type: control })}
      onType={type}
      onSave={() => submit({ type: 'user.profile.save-button' })}
      onSignOut={() => send({ type: 'user.profile.sign-out-button' })}
      confirmSignOut={state.matches({ editing: { session: 'confirming' } })}
      onConfirmSignOut={() => send({ type: 'user.profile.sign-out-dialog.confirm-button' })}
      onCancelSignOut={() => send({ type: 'user.profile.sign-out-dialog.cancel-button' })}
    />
  )
}
