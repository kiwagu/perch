/**
 * What the specs of a failed tell share. `specRetell` is what the re-tells of a spec's
 * `Organisations` run on: a manual clock a test moves past the delays, the middle of the jitter
 * (so the first re-tell is due after one second), and a log that drops every line, each replaced
 * by what the spec names. `readFailingAfter` is the directory hook that fails a tell the way the
 * specs do: the read of memberships that follows a change's directory statement fails once, so
 * the change itself is written. `organisationsRetelling` builds organisations over a gateway
 * root's directory with that hook, for the route specs.
 */

import { expect, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'

import type { GatewayRoot } from '../../composition/root'
import { Organisations, type RetellOptions } from '../organisations'
import membershipsOfStatement from '../surql/memberships-of.surql'

import { specInvitations } from './invitations'

export function specRetell(overrides: Partial<RetellOptions> = {}): RetellOptions {
  return {
    clock: manualClock(),
    random: () => 0.5,
    log: { error: () => {} },
    ...overrides,
  }
}

/**
 * A hook over the directory's statements that fails the read of memberships following
 * `statement`, once: the one the change's tell makes right after its commit.
 */
export function readFailingAfter(statement: string): (text: string) => void {
  let written = false

  return (text) => {
    if (text === statement) {
      written = true
    } else if (written && text === membershipsOfStatement) {
      written = false
      throw new Error('the directory went away for a moment')
    }
  }
}

/**
 * Organisations over the root's directory, databases, connections and hub, whose read of
 * memberships fails once after `statement`, with what their listener heard (`heard`) and
 * `retold()`, which moves their re-tells past the first delay and waits for the next list heard.
 */
export function organisationsRetelling(root: GatewayRoot, statement: string) {
  const clock = manualClock()
  const heard: Array<readonly [IdentityId, readonly Membership[]]> = []
  const organisations = new Organisations({
    directory: interceptQueries(root.local, readFailingAfter(statement)),
    databases: root.databases,
    revoke: (identity, region) => root.connections.revoke(identity, region),
    rerole: (identity, region, role) => root.connections.rerole(identity, region, role),
    hub: root.hub,
    invitations: specInvitations(root.local),
    retell: specRetell({ clock }),
  })

  organisations.onChange(async (identity, memberships) => {
    heard.push([identity, memberships])
  })

  const retold = async () => {
    const before = heard.length

    await clock.advance(1_200)
    await vi.waitFor(
      () => {
        expect(heard.length).toBe(before + 1)
      },
      { timeout: 5_000, interval: 1 },
    )
  }

  return { organisations, heard, retold }
}
