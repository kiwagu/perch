/**
 * Where the app has a machine of its own for a screen, its config is the screen's flow, as each
 * binding is a route the router matches (`routes-router.spec.ts`). The contract check already
 * runs every flow in XState; this holds the app's own machines to theirs, through the
 * engine's comparison (`@workspace/ui-contract/machines`): the same initial state, states,
 * final states, parallel states with the same regions and initial states, events with their
 * targets and guard names, invoke sources, and the contract's effects on the same transitions.
 * The app adds actions of its own (an `assign`), and its `input` is the app's, but no
 * mechanism the flow has no counterpart for. On a branch the pre-commit hook sets
 * `CONTRACT_AHEAD=1`: a business commit may change a flow before its implementation, so a
 * machine may lack what its flow added but does nothing the flow does not say; `bun run check`
 * and a commit on `main` hold every machine to its whole flow.
 */

import { join } from 'node:path'

import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens } from '@workspace/ui-contract'
import { aheadOf, beyondTheSubset, projected } from '@workspace/ui-contract/machines'

import { LocaleWrites } from '../features/app-shell/application/locale-writes'
import { createShellMachine } from '../features/app-shell/application/shell.machine'
import { createDevicesMachine } from '../features/device/application/devices.machine'
import { createOrganisationMachine } from '../features/organisation/application/organisation.machine'
import { createProfileMachine } from '../features/user/application/profile.machine'
import { createSignInMachine } from '../features/user/application/sign-in.machine'
import { SignInService } from '../features/user/application/sign-in.service'

import { fakeSession } from './__fixtures__/session'

const ROOT = join(import.meta.dirname, '../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

const { screens, problems } = loadScreens(ROOT)

/** The machines the app builds for a screen of the contract, by screen id. */
const APP_MACHINES: Readonly<Record<string, () => { readonly config: unknown }>> = {
  'app-shell': () =>
    createShellMachine({
      values: () => ({
        account: undefined,
        session: 0,
        storingIn: undefined,
        stored: undefined,
        writes: LocaleWrites.none,
      }),
      storeLocale: () => okAsync(undefined),
      signOutHere: () => okAsync(undefined),
      reload: () => {},
    }),
  device: () =>
    createDevicesMachine({
      revoke: () => okAsync(undefined),
      signOutEverywhere: () => okAsync(undefined),
    }),
  organisation: () =>
    createOrganisationMachine({
      select: () => undefined,
      create: () => okAsync(undefined),
      addNote: () => okAsync(undefined),
      editNote: () => okAsync(undefined),
      deleteNote: () => okAsync(undefined),
      invite: () => okAsync(undefined),
      remove: () => okAsync(undefined),
      current: () => undefined,
    }),
  'user.sign-in': () =>
    createSignInMachine(
      new SignInService(
        fakeSession().session,
        { createProfile: () => okAsync(undefined) },
        { createSettings: () => okAsync(undefined) },
      ),
    ),
  'user.profile': () =>
    createProfileMachine({
      profiles: { updateName: () => okAsync(undefined), updateBio: () => okAsync(undefined) },
      signOut: () => okAsync('signed-out' as const),
      values: () => ({
        id: undefined,
        stored: { name: '', bio: '' },
        drafts: { name: '', bio: '' },
      }),
    }),
}

describe('the machines of the app', () => {
  it('read the screens of the contract', () => {
    expect(problems.map(formatProblem)).toEqual([])
  })

  it.each(Object.entries(APP_MACHINES))('%s is the flow of its screen', (id, machine) => {
    const flow =
      screens?.screens.find((screen) => screen.id === id)?.flow ??
      expect.unreachable(`a flow of ${id}`)
    const { config } = machine()
    const app = projected(config)

    expect(beyondTheSubset(config), `what ${id} does beyond its flow`).toEqual([])
    expect(app).toEqual(AHEAD ? aheadOf(app, projected(flow)) : projected(flow))
  })
})
