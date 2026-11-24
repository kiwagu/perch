import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type IdentityId, identityIdFactory } from '@workspace/ids'

import type {
  AccountCard,
  AccountOrganisation,
  AccountPage,
  AccountSearch,
  AccountsPort,
  BanCode,
  ChangeEmailCode,
  ConsoleFailure,
  ListCode,
  ListedAccount,
  ReadCode,
  RemoveCode,
  RenameCode,
  ResendVerificationCode,
  RevokeSessionsCode,
  SendResetCode,
  UnbanCode,
} from '../accounts.port'

/** An operator of the platform, verified. */
export const opal: ListedAccount = {
  id: identityIdFactory.create(),
  name: 'Opal',
  email: 'opal@example.test',
  emailVerified: true,
  banned: false,
  operator: true,
  createdAt: new Date('2026-10-01T08:00:00.000Z'),
}

/** An account that signed up and never verified its email. */
export const una: ListedAccount = {
  id: identityIdFactory.create(),
  name: 'Una',
  email: 'una@example.test',
  emailVerified: false,
  banned: false,
  operator: false,
  createdAt: new Date('2026-10-05T08:00:00.000Z'),
}

/** A banned account, verified before its ban. */
export const bart: ListedAccount = {
  id: identityIdFactory.create(),
  name: 'Bart',
  email: 'bart@example.test',
  emailVerified: true,
  banned: true,
  operator: false,
  createdAt: new Date('2026-10-09T08:00:00.000Z'),
}

/**
 * `count` accounts named `<prefix> 1` to `<prefix> <count>`, made a minute apart from `from`, the
 * first made first.
 */
export function accountsNamed(
  prefix: string,
  count: number,
  from = new Date('2026-10-10T08:00:00.000Z'),
): ListedAccount[] {
  return Array.from({ length: count }, (_, index) => ({
    id: identityIdFactory.create(),
    name: `${prefix} ${index + 1}`,
    email: `${prefix.toLowerCase()}-${index + 1}@example.test`,
    emailVerified: false,
    banned: false,
    operator: false,
    createdAt: new Date(from.getTime() + index * 60_000),
  }))
}

/** A refusal of a console call with `code`. */
export const refusedWith = <Code extends string>(code: Code): ConsoleFailure<Code> => ({
  code,
  message: `the gateway refused: ${code}`,
})

/**
 * An account of the fake gateway: as the list shows it, with what its card adds when the test
 * gives it (a profile unless `hasProfile` says none, no organisation unless it lists some; the ban's
 * reason shown while it is banned and not empty).
 */
export interface FakeRow extends ListedAccount {
  readonly hasProfile?: boolean
  readonly lastSeenAt?: Date
  readonly banReason?: string
  readonly organisations?: readonly AccountOrganisation[]
}

/** The codes each action on an account fails with, by the port's name of it. */
interface ActionCodes {
  readonly rename: RenameCode
  readonly changeEmail: ChangeEmailCode
  readonly ban: BanCode
  readonly unban: UnbanCode
  readonly revokeSessions: RevokeSessionsCode
  readonly sendReset: SendResetCode
  readonly resendVerification: ResendVerificationCode
  readonly remove: RemoveCode
}

type Action = keyof ActionCodes

/** The codes every action on an account may fail with. */
type Shared = 'not-operator' | 'account-gone' | 'failed'

/** The account as a list shows it: never a ban's reason. */
const listedOf = (row: FakeRow): ListedAccount => ({
  id: row.id,
  name: row.name,
  email: row.email,
  emailVerified: row.emailVerified,
  banned: row.banned,
  operator: row.operator,
  createdAt: row.createdAt,
})

/** The account as its card shows it. */
const cardOf = (row: FakeRow): AccountCard => ({
  ...listedOf(row),
  hasProfile: row.hasProfile ?? true,
  organisations: row.organisations ?? [],
  ...(row.lastSeenAt === undefined ? {} : { lastSeenAt: row.lastSeenAt }),
  ...(row.banned && row.banReason !== undefined && row.banReason !== ''
    ? { banReason: row.banReason }
    : {}),
})

/**
 * The gateway's console routes in memory, for an operator: `rows` are the platform's accounts,
 * listed newest first and found by a part of the email or the name in any case, an id that names
 * none answering `account-gone`. A rename, a ban, an unban and a removal change the row as the
 * gateway does; the other actions change nothing the card shows. `refusal` makes the next call
 * fail with it, `refuse` the next call of one action with one of its codes; `hold` keeps every
 * answer until `release` lets them go, in order. Each call is recorded in `calls`.
 */
export class FakeAccounts implements AccountsPort {
  readonly calls: Array<readonly unknown[]> = []
  rows: readonly FakeRow[] = [opal, una, bart]
  refusal: ConsoleFailure<'not-operator' | 'failed'> | undefined = undefined
  hold = false
  readonly #held: Array<() => void> = []
  readonly #refusals: { [A in Action]?: ConsoleFailure<ActionCodes[A]> } = {}

  /** Lets every answer held so far go, the oldest first. */
  release(): void {
    for (const answer of this.#held.splice(0)) {
      answer()
    }
  }

  /** Makes the next call of `action` fail with `code`. */
  refuse<A extends Action>(action: A, code: ActionCodes[A]): void {
    Object.assign(this.#refusals, { [action]: refusedWith(code) })
  }

  #answer<T, Code extends string>(
    value: () => T,
    own?: ConsoleFailure<Code>,
  ): ResultAsync<T, ConsoleFailure<Code | 'not-operator' | 'failed'>> {
    const refusal = this.refusal ?? own

    this.refusal = undefined

    const answered = () => (refusal ? errAsync(refusal) : okAsync(value()))

    if (!this.hold) {
      return answered()
    }

    return ResultAsync.fromSafePromise(
      new Promise<void>((resolve) => {
        this.#held.push(resolve)
      }),
    ).andThen(answered)
  }

  /**
   * One action on the account `id`, recorded with `args`: once answered, its row becomes what
   * `change` makes of it, none for a removal.
   */
  #act<A extends Action>(
    action: A,
    id: IdentityId,
    args: readonly unknown[],
    change: (row: FakeRow) => FakeRow | undefined = (row) => row,
  ): ResultAsync<void, ConsoleFailure<ActionCodes[A] | Shared>> {
    this.calls.push([action, id, ...args])

    const own = this.#refusals[action]

    delete this.#refusals[action]

    if (!this.rows.some((row) => row.id === id)) {
      return errAsync(refusedWith('account-gone'))
    }

    return this.#answer(() => {
      this.rows = this.rows.flatMap((row) => (row.id === id ? (change(row) ?? []) : [row]))
    }, own)
  }

  list(search: AccountSearch): ResultAsync<AccountPage, ConsoleFailure<ListCode>> {
    this.calls.push(['list', search])

    return this.#answer(() => {
      const q = search.q.toLowerCase()
      const found = this.rows
        .filter((row) => row.email.toLowerCase().includes(q) || row.name.toLowerCase().includes(q))
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(listedOf)
      const start = (search.page - 1) * search.size

      return { accounts: found.slice(start, start + search.size), total: found.length }
    })
  }

  read(id: IdentityId): ResultAsync<AccountCard, ConsoleFailure<ReadCode>> {
    this.calls.push(['read', id])

    const row = this.rows.find((each) => each.id === id)

    if (row === undefined) {
      return errAsync(refusedWith('account-gone'))
    }

    return this.#answer(() => cardOf(row))
  }

  rename(id: IdentityId, name: string) {
    return this.#act('rename', id, [name], (row) => ({ ...row, name: name.trim() }))
  }

  changeEmail(id: IdentityId, email: string) {
    return this.#act('changeEmail', id, [email])
  }

  ban(id: IdentityId, reason: string) {
    return this.#act('ban', id, [reason], (row) => ({
      ...row,
      banned: true,
      banReason: reason.trim(),
    }))
  }

  unban(id: IdentityId) {
    return this.#act('unban', id, [], (row) => ({ ...row, banned: false }))
  }

  revokeSessions(id: IdentityId) {
    return this.#act('revokeSessions', id, [])
  }

  sendReset(id: IdentityId) {
    return this.#act('sendReset', id, [])
  }

  resendVerification(id: IdentityId) {
    return this.#act('resendVerification', id, [])
  }

  remove(id: IdentityId) {
    return this.#act('remove', id, [], () => undefined)
  }
}
