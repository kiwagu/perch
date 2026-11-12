/**
 * Opening the space of an identity a sign-in, a restore or another tab's sign-in names: its
 * database, opened while the space's code loads, its channel, lead and hints, and the errors its
 * space reports.
 */

import { err, errAsync, ok, ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError } from '@workspace/data'
import { leadership, lockName } from '@workspace/replica/sync'

import type { openIdentitySpace } from '../../identity-space'
import { spaceCode } from '../../space-code'
import type { KeptSession, SavedSignIn } from '../../storage'
import type { SessionHost } from '../host'
import type { SpaceStatus } from '../open-space'
import type { SessionOptions, TransportContext } from '../options'
import type { SessionOrganisations } from '../organisations'
import { rejectionOf } from '../push-rejection'
import type { HeardSignOut, WriteBarrier } from '../write-barrier'

import { closedDuringSignIn } from './closed'

/** What opening an identity's space takes from the session. */
export interface OpenSpaceDeps {
  readonly host: SessionHost
  readonly organisations: SessionOrganisations
  readonly barrier: WriteBarrier
  /** What the channel of a sign-in's space tells the session (`SessionElsewhere`). */
  readonly transportContext: (session: KeptSession) => TransportContext
}

/**
 * Opens the space of the sign-in `signedIn` and makes it the session's, unless the session was
 * closed meanwhile (`generation` is no longer the latest): then the space closes again and the
 * open fails. A space whose code does not load closes the database it opened for it.
 */
export function openSpaceOf(
  deps: OpenSpaceDeps,
  signedIn: SavedSignIn,
  generation: number,
): ResultAsync<AuthUser, DataError> {
  const identity = signedIn.user
  const options = deps.host.options
  // The identity's database opens while the space's code loads: its engine in its worker, beside
  // Loro's on the page.
  const local = options.openLocal(identity.id)
  const openLocal: SessionOptions['openLocal'] = (id) =>
    id === identity.id ? local : options.openLocal(id)

  return ResultAsync.fromPromise(spaceCode(), (cause) =>
    dataError('data:OPEN_FAILED', "the space's code did not load", cause),
  )
    .orElse((error) =>
      // The database opened for a space whose code did not load closes again.
      ResultAsync.fromSafePromise(
        local.match(
          (db) => db.close(),
          () => undefined,
        ),
      ).andThen(() => errAsync(error)),
    )
    .andThen((code) => openSpaceWith(deps, code.openIdentitySpace, signedIn, generation, openLocal))
}

function openSpaceWith(
  deps: OpenSpaceDeps,
  open: typeof openIdentitySpace,
  signedIn: SavedSignIn,
  generation: number,
  openLocal: SessionOptions['openLocal'],
): ResultAsync<AuthUser, DataError> {
  const identity = signedIn.user
  const host = deps.host
  const options = host.options
  const status: SpaceStatus = { live: true }
  const lead = leadership(options.locks, lockName(identity.id))
  const hints = options.hints(identity.id)
  const heard: HeardSignOut = { at: undefined }

  // Another tab's sign-out holds this tab's writes back until it ends; the space closes the hints.
  hints.on((hint) => deps.barrier.hear(heard, hint))

  return open({
    identity,
    openLocal,
    openTenantLocal: options.openTenantLocal,
    deleteTenantLocal: options.deleteTenantLocal,
    tenantDatabases: deps.organisations.databases(identity.id),
    ...deps.organisations.saved(signedIn.session),
    schema: options.schema,
    transport: () => options.transport(deps.transportContext(signedIn.session)),
    leadership: lead,
    hints,
    clock: options.clock,
    onState: (state) => {
      if (status.live) {
        options.onSyncState(state)
      }
    },
    onError: (error) => report(host, error),
  })
    .mapErr((error) => {
      status.live = false

      return error
    })
    .andThen((space) => {
      if (generation !== host.generation()) {
        status.live = false
        host.retire(space.close())

        return err(closedDuringSignIn())
      }

      host.opened({ space, signIn: signedIn.session, leadership: lead, status, hints, heard })
      space.visibility(options.visibility.current())
      options.onStep?.('ready')
      host.emit(identity)

      return ok(identity)
    })
}

/** Reports an error of the space; a refused push is also published (`sync.change-rejected`, `sync.changes-reloaded`). */
function report(host: SessionHost, error: DataError): void {
  const rejection = rejectionOf(error)

  if (rejection) {
    const about = {
      payload: rejection,
      actorId: host.open()?.space.identity.id ?? 'anonymous',
      occurredAt: new Date(),
    }

    host.options.publish(
      rejection.reloaded
        ? { name: 'sync.changes-reloaded', ...about }
        : { name: 'sync.change-rejected', ...about },
    )
  }

  host.options.onError(error)
}
