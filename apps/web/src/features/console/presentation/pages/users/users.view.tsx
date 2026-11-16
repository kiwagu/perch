import type { MouseEvent } from 'react'

import { useFormats, useT } from '@workspace/i18n'
import type { IdentityId } from '@workspace/ids'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'
import { itemIdOf, type Pager, pagerOf, testIdFor } from '@workspace/ui-contract/anchors'

import type { AccountPage, ListCode, ListedAccount } from '../../../../../platform/accounts.port'
import { ACCOUNT_ITEM, type UsersEvent } from '../../../application/users.machine'
import { ACCOUNT_PAGE_SIZES, type AccountPageSize } from '../../../domain/account-search.entity'
import { MarkBadge } from '../../components/mark-badge/mark-badge.view'

export interface UsersViewProps {
  /** What the search box holds: the address's text, or what was typed since the address changed. */
  readonly text: string
  readonly onText: (text: string) => void
  /** Moves to the first page of what the box holds; resolves once the flow took it. */
  readonly onSearch: () => Promise<boolean>
  /** The page of accounts the address names; undefined while it is read, or when it failed. */
  readonly page: AccountPage | undefined
  /** Why the page could not be read, shown in the place of the list. */
  readonly failure: ListCode | undefined
  /** The page the address names, and how many accounts a page holds. */
  readonly at: { readonly page: number; readonly size: AccountPageSize }
  /** The address of page `page` of the same search. */
  readonly pageHref: (page: number) => string
  /** Moves to page `page` of the same search. */
  readonly onPage: (page: number) => void
  /** Moves to the first page of the same search, `size` accounts a page. */
  readonly onSize: (size: AccountPageSize) => void
  /** The address of the card of the account `id`. */
  readonly accountHref: (id: IdentityId) => string
  /** Opens the card of the account whose row's link was followed: the row's own id. */
  readonly onOpen: (id: string) => void
  /** Whether the page's flow takes the event now: a control is enabled exactly while it does. */
  readonly can: (event: UsersEvent) => boolean
}

/**
 * A click the app moves for itself: the primary button with no modifier. Any other (a new tab, a
 * new window, a download) is the browser's, which follows the link's own address.
 */
const isPlainClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/**
 * A link the app follows itself on a plain click, the browser on any other: a touch target of 44
 * by 44 CSS px at least.
 */
function MovingLink(props: {
  readonly href: string
  readonly testId: string
  readonly onMove: (link: HTMLAnchorElement) => void
  readonly children: string
}) {
  return (
    <a
      href={props.href}
      className="inline-flex min-h-11 min-w-11 items-center text-sm underline"
      data-testid={props.testId}
      onClick={(event) => {
        if (isPlainClick(event)) {
          event.preventDefault()
          props.onMove(event.currentTarget)
        }
      }}
    >
      {props.children}
    </a>
  )
}

function AccountRow(props: {
  readonly account: ListedAccount
  readonly href: string
  readonly onOpen: (id: string) => void
}) {
  const t = useT()
  const when = useFormats().dateTime
  const { account } = props

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="console.users.list.account-item"
      data-id={account.id}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span
          className="min-w-0 font-medium break-words"
          data-testid="console.users.list.name-cell"
        >
          {account.name}
        </span>
        <span className="min-w-0 text-sm break-all" data-testid="console.users.list.email-cell">
          {account.email}
        </span>
        <span className="flex flex-wrap gap-2">
          {account.emailVerified ? (
            <MarkBadge testId="console.users.list.verified-badge">
              {t('console.users.list.verified')}
            </MarkBadge>
          ) : null}
          {account.banned ? (
            <MarkBadge testId="console.users.list.banned-badge">
              {t('console.users.list.banned')}
            </MarkBadge>
          ) : null}
          {account.operator ? (
            <MarkBadge testId="console.users.list.operator-badge">
              {t('console.users.list.operator')}
            </MarkBadge>
          ) : null}
        </span>
        <span
          className="text-sm text-muted-foreground"
          data-testid="console.users.list.created-cell"
        >
          {t('console.users.list.created', { when: when(account.createdAt) })}
        </span>
      </div>
      <MovingLink
        href={props.href}
        testId="console.users.list.open-link"
        // The id that moves is the row's own, read off the page as a test reads it.
        onMove={(link) => props.onOpen(itemIdOf(link, ACCOUNT_ITEM))}
      >
        {t('console.users.list.open')}
      </MovingLink>
    </li>
  )
}

/** Which accounts the page shows of how many, as numbers and in words. */
function Range(props: { readonly pager: Pager }) {
  const t = useT()
  const { from, to, total } = props.pager.range

  return (
    <p
      className="text-sm text-muted-foreground"
      data-testid={testIdFor('console.users.list', 'range')}
      data-from={from}
      data-to={to}
      data-total={total}
    >
      {from === 0
        ? t('console.users.list.range-none', { total })
        : t('console.users.list.range', { from, to, total })}
    </p>
  )
}

/** The contract's code of a failed read, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: ListCode): string {
  return code === 'not-operator'
    ? t('console.users.error.not-operator')
    : t('console.users.error.failed')
}

/**
 * The platform's accounts, for an operator: the search box, then a page of the accounts it finds,
 * newest first, each row with its name, email, marks, when it was made and a link to its card;
 * which accounts the page shows of how many, the size of a page and the links to the pages before
 * and after where there are any. A read that failed says why in the place of the list.
 */
export function UsersView(props: UsersViewProps) {
  const t = useT()
  const { page } = props
  const pager =
    page === undefined
      ? undefined
      : pagerOf({ ...props.at, shown: page.accounts.length, total: page.total })
  const state = page === undefined ? 'loading' : page.total === 0 ? 'empty' : 'ready'
  const previous = pager?.previous
  const next = pager?.next
  const fields = { 'console.users.search-input': props.text }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h1 data-testid="console.users.heading">{t('console.users.heading')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Form
          onSubmit={props.onSearch}
          className="flex flex-wrap gap-2"
          data-testid="console.users.search-form"
        >
          <Input
            className="min-w-0 flex-1"
            value={props.text}
            onChange={(event) => props.onText(event.target.value)}
            aria-label={t('console.users.search')}
            data-testid="console.users.search-input"
          />
          <Button
            type="submit"
            disabled={!props.can({ type: 'console.users.search-button', fields })}
            data-testid="console.users.search-button"
          >
            {t('console.users.search-button')}
          </Button>
        </Form>
        {props.failure === undefined ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {pager ? <Range pager={pager} /> : <span />}
              <OptionSelect
                label={t('console.users.list.size')}
                value={String(props.at.size)}
                options={ACCOUNT_PAGE_SIZES.map((size) => ({
                  value: String(size),
                  label: String(size),
                }))}
                onChange={(chosen) => {
                  const size = ACCOUNT_PAGE_SIZES.find((each) => String(each) === chosen)

                  if (size !== undefined) {
                    props.onSize(size)
                  }
                }}
                holdsInput={false}
                testId={testIdFor('console.users.list', 'size-select')}
              />
            </div>
            <ul className="flex flex-col gap-4" data-testid="console.users.list" data-state={state}>
              {page?.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  href={props.accountHref(account.id)}
                  onOpen={props.onOpen}
                />
              ))}
            </ul>
            {state === 'loading' ? (
              <p className="text-muted-foreground" role="status">
                {t('console.users.list.loading')}
              </p>
            ) : null}
            {state === 'empty' ? (
              <p className="text-muted-foreground">{t('console.users.list.empty')}</p>
            ) : null}
            <div className="flex justify-between gap-2">
              {previous === undefined ? (
                <span />
              ) : (
                <MovingLink
                  href={props.pageHref(previous)}
                  testId={testIdFor('console.users.list', 'previous-link')}
                  onMove={() => props.onPage(previous)}
                >
                  {t('console.users.list.previous')}
                </MovingLink>
              )}
              {next === undefined ? null : (
                <MovingLink
                  href={props.pageHref(next)}
                  testId={testIdFor('console.users.list', 'next-link')}
                  onMove={() => props.onPage(next)}
                >
                  {t('console.users.list.next')}
                </MovingLink>
              )}
            </div>
          </>
        ) : (
          <Alert variant="destructive">
            <AlertDescription data-testid="console.users.error" data-code={props.failure}>
              {errorOf(t, props.failure)}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
