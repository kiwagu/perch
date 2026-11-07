/** What a seed client is given, what it answers, and what its steps use of its device. */

import type { ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { AuthUser, DataError, SignInInput } from '@workspace/data'
import type { Locale } from '@workspace/i18n'
import type { ProfileId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { NoteRow, NotesService } from '../../features/organisation/application/notes.service'
import type { ProfileRow, ProfileService } from '../../features/user/application/profile.service'
import type {
  SettingsRow,
  SettingsService,
} from '../../features/user/application/settings/settings.service'
import type { InvitationsPort } from '../../platform/invitations.port'
import type { OrganisationsPort } from '../../platform/organisations.port'
import type { SessionPort } from '../../platform/session.port'
import type { CommandLogger } from '../commands'
import type { Fetcher } from '../gateway-auth'

/**
 * Where the seed reads an account's verification link: the stand's mailbox (`@workspace/mailbox`'s
 * `Mailbox` is one).
 */
export interface Inbox {
  /** How many mails reached `email` so far. */
  count(email: string): Promise<number>
  /** The token of the verification link in the mail to `email` after its first `seen`, once it arrives. */
  verificationToken(email: string, seen: number): Promise<string>
}

export interface ClientOptions {
  /** The gateway's address, such as `http://127.0.0.1:5181`; its sync WebSocket is `/sync` under it. */
  readonly gatewayUrl: string
  /**
   * What the client calls the gateway's HTTP routes with, the global `fetch` by default: a test
   * that talks to the gateway directly plays the front with it, naming a client address.
   */
  readonly fetcher?: Fetcher
  readonly logger?: CommandLogger
  /** The stand's mailbox, where the client reads the verification link of each account it signs up. */
  readonly inbox: Inbox
}

export interface AccountInput {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly bio: string
  readonly locale: Locale
}

export interface SeededAccount {
  readonly user: AuthUser
  readonly profileId: ProfileId
}

/** An account as a device sees it once it has caught up with the gateway. */
export interface AccountView {
  readonly user: AuthUser
  readonly profile: ProfileRow | undefined
  readonly settings: SettingsRow | undefined
}

/** An organisation as a member's device sees it once it has caught up with the gateway. */
export interface OrganisationView {
  readonly membership: Membership
  readonly notes: readonly NoteRow[]
}

export type SeedError = DataError | BusError

/**
 * What the invite of a member answers: the id of the invitation the member accepts, or that the
 * account is a member already, which leaves nothing to accept.
 */
export type Invited =
  | { readonly kind: 'invited'; readonly invitation: string }
  | { readonly kind: 'already-member' }

/**
 * One device, signed in as one account at a time: signing in as the next account leaves the
 * previous one, and closing leaves the last one. Leaving closes the account's space and drops
 * its in-memory database, but never signs the account out, which would end its session.
 */
export interface SeedClient {
  /**
   * Signs in, or signs up and verifies the account through its mail in the stand's mailbox; an
   * email that has an account with another password fails as invalid credentials, as a sign-in
   * does. Then writes the profile and the settings through commands and waits until the gateway
   * acknowledged everything.
   */
  ensureAccount(input: AccountInput): ResultAsync<SeededAccount, SeedError>
  /** Signs in as an existing account and waits for the first catch-up; the organisation calls act as it. */
  signIn(input: SignInInput): ResultAsync<AuthUser, SeedError>
  /**
   * Creates the organisation as the signed-in account, its administrator. An organisation that
   * exists and that the account administers (the gateway completes its creator's interrupted
   * provisioning on a retry) is found; one it only belongs to, and any other refusal, is an error.
   */
  ensureOrganisation(input: {
    readonly key: string
    readonly name: string
  }): ResultAsync<Membership, SeedError>
  /**
   * Invites the existing account at `email` into the organisation as a member, as the signed-in
   * administrator: answers the invitation's id; an account that is a member already is found
   * (`already-member`). The account is a member once it accepts (`ensureJoined`).
   */
  ensureInvited(key: string, email: string): ResultAsync<Invited, SeedError>
  /**
   * Accepts the invitation by its id as the signed-in account, which becomes a member of its
   * organisation, and waits until the gateway acknowledged everything.
   */
  ensureJoined(invitation: string): ResultAsync<Membership, SeedError>
  /** Signs in, makes the organisation current and reads its notes once the gateway's copy has arrived; writes nothing. */
  readOrganisation(key: string, input: SignInInput): ResultAsync<OrganisationView, SeedError>
  /** Signs in and reads the profile and the settings once the gateway's copy of the account's region has arrived; writes nothing. */
  readAccount(input: SignInInput): ResultAsync<AccountView, SeedError>
  close(): Promise<void>
}

/** The seed client's device as its account steps use it: its session, services and mailbox. */
export interface SeedDevice {
  readonly session: Pick<SessionPort, 'signIn' | 'signUp' | 'verifyEmail' | 'resendVerification'>
  readonly profiles: Pick<ProfileService, 'read' | 'createProfile' | 'updateBio'>
  readonly settings: Pick<SettingsService, 'read' | 'createSettings' | 'updateLocale'>
  readonly inbox: Inbox
  /**
   * Signs in through `signIn` and waits for the first catch-up, which brings what the gateway
   * holds; the account the device is in signs out first.
   */
  enter(signIn: () => ResultAsync<AuthUser, SeedError>): ResultAsync<AuthUser, SeedError>
  /** Waits until the gateway answered and acknowledged everything, and the region is projected. */
  settle(): ResultAsync<void, SeedError>
}

/** The seed client's device as its organisation steps use it. */
export interface SeedOrganisationDevice {
  readonly session: Pick<SessionPort, 'signIn' | 'memberships' | 'selectTenant' | 'currentTenant'>
  readonly organisations: Pick<OrganisationsPort, 'create' | 'invite'>
  readonly invitations: Pick<InvitationsPort, 'accept'>
  readonly notes: Pick<NotesService, 'read'>
  enter(signIn: () => ResultAsync<AuthUser, SeedError>): ResultAsync<AuthUser, SeedError>
  settle(): ResultAsync<void, SeedError>
}
