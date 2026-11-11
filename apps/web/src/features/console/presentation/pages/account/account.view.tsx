import type { ComponentType, ReactNode } from 'react'
import { match } from 'ts-pattern'

import { useFormats, useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type {
  AccountCard,
  AccountOrganisation,
  ReadCode,
} from '../../../../../platform/accounts.port'
import { MarkBadge } from '../../components/mark-badge/mark-badge.view'

import { type AccountAreasProps, AccountAreasView, TOUCH_TARGET } from './account-areas.view'

/** A link of the card to a route. */
export interface AccountLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

export interface AccountViewProps {
  /** The account as read; undefined while it is read, or when the read failed. */
  readonly account: AccountCard | undefined
  /** Why the account could not be read, shown in the place of the section. */
  readonly failure: ReadCode | undefined
  /**
   * What the areas that act on the account hold and do, once it is read; none where no account
   * is named, which nothing acts on.
   */
  readonly areas?: Omit<AccountAreasProps, 'account'> | undefined
  /** The router's link, which the page gives its view; a plain one without it. */
  readonly link?: ComponentType<AccountLinkProps>
}

/** A plain link, which the view draws when it is given none: its tests run without a router. */
const PlainLink = ({ to, ...props }: AccountLinkProps) => <a href={to} {...props} />

type Translate = ReturnType<typeof useT>

/** The words of the code the section's error shows. */
function failureText(t: Translate, code: ReadCode): string {
  return match(code)
    .with('not-operator', () => t('console.account.error.not-operator'))
    .with('account-gone', () => t('console.account.error.account-gone'))
    .with('failed', () => t('console.account.error.failed'))
    .exhaustive()
}

/** The words of the account's role in an organisation. */
function roleText(t: Translate, role: AccountOrganisation['role']): string {
  return match(role)
    .with('admin', () => t('console.account.organisations.role.admin'))
    .with('member', () => t('console.account.organisations.role.member'))
    .exhaustive()
}

/** The account as read: its email, its dates, its marks and its ban's reason. */
function Details(props: { readonly account: AccountCard }) {
  const t = useT()
  const when = useFormats().dateTime
  const { account } = props

  return (
    <div className="flex flex-col gap-1">
      <p className="min-w-0 break-all" data-testid="console.account.email-cell">
        {account.email}
      </p>
      <span className="flex flex-wrap gap-2">
        {account.emailVerified ? (
          <MarkBadge testId="console.account.verified-badge">
            {t('console.account.verified')}
          </MarkBadge>
        ) : null}
        {account.banned ? (
          <MarkBadge testId="console.account.banned-badge">{t('console.account.banned')}</MarkBadge>
        ) : null}
        {account.operator ? (
          <MarkBadge testId="console.account.operator-badge">
            {t('console.account.operator')}
          </MarkBadge>
        ) : null}
      </span>
      {account.banned && account.banReason !== undefined ? (
        <p className="min-w-0 text-sm break-words" data-testid="console.account.reason-cell">
          {t('console.account.reason', { reason: account.banReason })}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground" data-testid="console.account.created-cell">
        {t('console.account.created', { when: when(account.createdAt) })}
      </p>
      {account.lastSeenAt === undefined ? null : (
        <p className="text-sm text-muted-foreground" data-testid="console.account.seen-cell">
          {t('console.account.seen', { when: when(account.lastSeenAt) })}
        </p>
      )}
    </div>
  )
}

/** The organisations the account is a member of, each with its role; none when it is in none. */
function Organisations(props: { readonly account: AccountCard }) {
  const t = useT()
  const { organisations } = props.account

  if (organisations.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{t('console.account.organisations.title')}</h2>
      <ul className="flex flex-col gap-2" data-testid="console.account.organisations.list">
        {organisations.map((organisation) => (
          <li
            key={organisation.key}
            className="flex flex-wrap items-center justify-between gap-2"
            data-testid="console.account.organisations.item"
            data-id={organisation.key}
          >
            <span
              className="min-w-0 break-words"
              data-testid="console.account.organisations.name-cell"
            >
              {organisation.name}
            </span>
            <MarkBadge testId="console.account.organisations.role-badge" value={organisation.role}>
              {roleText(t, organisation.role)}
            </MarkBadge>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One account of the platform, for an operator: the way back to the accounts, then the account
 * named in the heading, with its email, dates, marks and organisations and the areas that act on
 * it; the account is being read until then. A read that failed says why in the place of the
 * section.
 */
export function AccountView(props: AccountViewProps) {
  const t = useT()
  const { account, failure, areas } = props
  const Link = props.link ?? PlainLink

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="flex flex-col gap-2">
        <Link
          to="/console/users"
          className={`${TOUCH_TARGET} inline-flex items-center self-start text-sm underline`}
          data-testid="console.account.back-link"
        >
          {t('console.account.back')}
        </Link>
        {failure === undefined && account !== undefined ? (
          <CardTitle>
            <h1 className="min-w-0 break-words" data-testid="console.account.heading">
              {account.name}
            </h1>
          </CardTitle>
        ) : null}
      </CardHeader>
      <CardContent>
        {failure === undefined ? (
          <section
            className="flex flex-col gap-6"
            data-testid="console.account.section"
            data-state={account === undefined ? 'loading' : 'ready'}
          >
            {account === undefined ? (
              <p className="text-muted-foreground" role="status">
                {t('console.account.loading')}
              </p>
            ) : (
              <>
                <Details account={account} />
                <Organisations account={account} />
                {areas === undefined ? null : <AccountAreasView account={account} {...areas} />}
              </>
            )}
          </section>
        ) : (
          <Alert variant="destructive">
            <AlertDescription data-testid="console.account.error" data-code={failure}>
              {failureText(t, failure)}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
