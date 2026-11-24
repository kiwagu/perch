/**
 * The roles this device holds, as the router and the frame read them (`heldRoles` of the UI
 * contract): `guest` alone while nobody is signed in; else `identity`, the account's role in the
 * organisation current, if any, and the platform roles the latest welcome of its channel carried.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { heldRoles } from '@workspace/ui-contract/anchors'

import { useService } from './module'
import { SESSION, type SessionPort } from './session.port'

/** What of the session the roles held are read from. */
export type RolesSource = Pick<SessionPort, 'current' | 'currentTenant' | 'roles'>

/** The roles a device holds by its session now. */
export function heldBy(session: RolesSource): ReadonlySet<string> {
  const tenant = session.currentTenant()

  return heldRoles(session.current() !== undefined, [
    ...(tenant === undefined ? [] : [tenant.role]),
    ...session.roles(),
  ])
}

/** Joins the roles held into one text, which stays the same while they do. */
const SEPARATOR = ' '

/**
 * The roles this device holds, kept current: a sign-in or a sign-out, the platform roles read
 * anew, another organisation or another role in it each render them again.
 */
export function useHeldRoles(): ReadonlySet<string> {
  const session = useService(SESSION)
  const subscribe = useCallback(
    (onChange: () => void) => {
      const stops = [
        session.subscribe(onChange),
        session.onRoles(onChange),
        session.subscribeMemberships(onChange),
      ]

      return () => {
        for (const stop of stops) {
          stop()
        }
      }
    },
    [session],
  )
  const held = useSyncExternalStore(subscribe, () => [...heldBy(session)].join(SEPARATOR))

  return useMemo(() => new Set(held.split(SEPARATOR)), [held])
}
