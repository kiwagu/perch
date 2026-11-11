import { Link } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { useService } from '../../../../../platform/module'
import { SESSION } from '../../../../../platform/session.port'

import { type NotFoundLinkProps, NotFoundView } from './not-found.view'

const RouterLink = ({ to, ...props }: NotFoundLinkProps) => <Link to={to} {...props} />

/**
 * The page of an address no other route takes, and of a page whose roles the device does not hold,
 * at its address; its way back chosen by whether someone is signed in.
 */
export function NotFoundContainer() {
  const session = useService(SESSION)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )

  return <NotFoundView signedIn={user !== undefined} link={RouterLink} />
}
