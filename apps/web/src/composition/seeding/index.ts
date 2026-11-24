/**
 * Seeding from Bun or Node with the application itself. A seed client is a device of the
 * application in this process: the composition root over an in-memory database, signing in
 * through the gateway's HTTP routes, or up, verifying each new account through the mail in the
 * stand's mailbox (`Inbox`), writing the profile and the settings with the user module's
 * services, the command bus and the Loro write path of the identity's region, and syncing the
 * region over the gateway's WebSocket like any device. A stand is reached directly only by its
 * operator, as a system user on the gateway's database, to sweep seeded accounts. Never part of
 * the browser bundle.
 */

export type { NoteRow } from '../../features/organisation/application/notes.service'
export type { ProfileRow } from '../../features/user/application/profile.service'
export { checkProfileName } from '../../features/user/domain/profile-name.rule'
export type { Fetcher } from '../gateway-auth'
export { openStand, openStandTenant, type Stand, type StandOptions } from '../seed-stand'

export { openClient } from './client'
export type {
  AccountInput,
  AccountView,
  ClientOptions,
  Inbox,
  Invited,
  OrganisationView,
  SeedClient,
  SeedError,
  SeededAccount,
} from './types'
