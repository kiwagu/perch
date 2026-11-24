import type { ComponentType, ReactNode } from 'react'

import { useT } from '@workspace/i18n'
import { CONTRACT_ROUTES } from '@workspace/kernel'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

export interface NotFoundLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

export interface NotFoundViewProps {
  /** Someone is signed in on this device: the way back is the profile, else signing in. */
  readonly signedIn: boolean
  readonly link?: ComponentType<NotFoundLinkProps>
}

const PlainLink = ({ to, ...props }: NotFoundLinkProps) => <a href={to} {...props} />

/** Says no page is at the address, with one way back. */
export function NotFoundView(props: NotFoundViewProps) {
  const t = useT()
  const Link = props.link ?? PlainLink

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 data-testid="not-found.page.heading">{t('not-found.page.heading')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {props.signedIn ? (
          <Link
            to={CONTRACT_ROUTES['user.profile']}
            className="underline"
            data-testid="not-found.page.profile-link"
          >
            {t('not-found.page.profile')}
          </Link>
        ) : (
          <Link
            to={CONTRACT_ROUTES['user.sign-in']}
            className="underline"
            data-testid="not-found.page.sign-in-link"
          >
            {t('not-found.page.sign-in')}
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
