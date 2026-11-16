/**
 * The adoption of a membership the gateway answers this tab (an organisation created, an
 * invitation accepted) into the space that asked for it. The adopter is taken before the request
 * and bound to the space open then, or to the space the start's open produces, or to nothing;
 * at the answer it adopts nothing when that space is no longer the open one, is signing out or
 * is closing: the gateway tells the membership over the channel to whichever space is open then.
 */

import type { Membership } from '@workspace/replica/protocol'

import type { OpenSpace } from './open-space'
import type { SessionOrganisations } from './organisations'
import type { SessionState } from './state'

/** Adopts `joined`, the gateway's answer, into the space the adopter was taken for; resolves once that space followed its list. */
export type MembershipAdopter = (joined: Membership) => Promise<void>

export interface MembershipAdoptionOptions {
  readonly host: SessionState
  readonly organisations: SessionOrganisations
  /** Whether a sign-out this browser began holds the writes of `open` back. */
  readonly signingOut: (open: OpenSpace) => boolean
}

export class MembershipAdoption {
  readonly #options: MembershipAdoptionOptions

  constructor(options: MembershipAdoptionOptions) {
    this.#options = options
  }

  /**
   * An adopter for the request made now: bound to the open space, else to the space the start's
   * open under way produces, once it ended, while that space is the asking account's; with
   * neither, no space asked and nothing is adopted.
   */
  adopter(): MembershipAdopter {
    const host = this.#options.host
    const open = host.open()

    if (open) {
      return (joined) => this.#into(open, joined)
    }

    const opening = host.opening()

    if (opening) {
      return (joined) =>
        opening.settled.then(() => {
          const produced = opening.produced()

          // The restore's own turn reads the saved identity again: another tab may have signed
          // another account in meanwhile, whose space it opened instead. Nothing was asked in
          // that account's name.
          return produced && produced.space.identity.id === opening.user.id
            ? this.#into(produced, joined)
            : undefined
        })
    }

    return () => Promise.resolve()
  }

  /** Adopts `joined` into `open` while it is still the session's space, live and not signing out. */
  #into(open: OpenSpace, joined: Membership): Promise<void> {
    const { host, organisations, signingOut } = this.#options

    if (host.open() !== open || host.isClosed() || !open.status.live || signingOut(open)) {
      return Promise.resolve()
    }

    return organisations.adopt(open, joined)
  }
}
