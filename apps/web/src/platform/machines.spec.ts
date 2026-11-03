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
 * machine may lack what its flow added but does nothing the flow does not say, or is still
 * exactly its screen's flow at the branch's base (`CONTRACT_AHEAD_BASE`), so a business commit
 * may change a transition before its implementation; `bun run check` and a commit on `main`
 * hold every machine to its whole flow.
 */

import { join } from 'node:path'

import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { contractAt, formatProblem, loadScreens } from '@workspace/ui-contract'
import { beyondTheSubset, laggingOf, projected } from '@workspace/ui-contract/machines'

import { NOTHING_SEEN } from '../features/app-shell/application/setting-writes'
import { createShellMachine } from '../features/app-shell/application/shell.machine'
import { createDevicesMachine } from '../features/device/application/devices.machine'
import { createOrganisationMachine } from '../features/organisation/application/organisation.machine'
import { createConfirmEmailMachine } from '../features/user/application/confirm-email.machine'
import { createForgotPasswordMachine } from '../features/user/application/forgot-password.machine'
import { createProfileMachine } from '../features/user/application/profile.machine'
import { createResetPasswordMachine } from '../features/user/application/reset-password.machine'
import { createSettingsMachine } from '../features/user/application/settings/settings-machine'
import { SignInService } from '../features/user/application/sign-in.service'
import { createSignInMachine } from '../features/user/application/sign-in-machine'
import { createVerifyEmailMachine } from '../features/user/application/verify-email.machine'

import { fakeSession } from './__fixtures__/session'

const ROOT = join(import.meta.dirname, '../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

/** The merge base of the branch with `main`, which the pre-commit hook names on a branch. */
const BASE = process.env['CONTRACT_AHEAD_BASE']

/**
 * The flows of the screens at the branch's base, by screen id (none outside the hook's ahead
 * mode, or where the base has no contract), or why the contract there does not load.
 */
type AtBase = { readonly flows: ReadonlyMap<string, unknown> } | { readonly problem: string }

function flowsAtBase(): AtBase {
  if (!AHEAD || BASE === undefined || BASE === '') {
    return { flows: new Map() }
  }

  let base: ReturnType<typeof contractAt>

  try {
    base = contractAt(BASE, ROOT)
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }

  return {
    flows:
      'missing' in base
        ? new Map()
        : new Map(
            base.screens.screens.flatMap((screen) =>
              screen.flow === undefined ? [] : [[screen.id, screen.flow] as const],
            ),
          ),
  }
}

const AT_BASE = flowsAtBase()

const { screens, problems } = loadScreens(ROOT)

/** The machines the app builds for a screen of the contract, by screen id. */
const APP_MACHINES: Readonly<Record<string, () => { readonly config: unknown }>> = {
  'app-shell': () =>
    createShellMachine({
      values: () => ({
        account: undefined,
        stored: undefined,
        writes: NOTHING_SEEN,
        unsaved: false,
      }),
      signOutHere: () => okAsync(undefined),
      reload: () => {},
      setTheme: () => {},
      selfReloads: { done: () => false, mark: () => {} },
      install: { prompt: () => Promise.resolve(), postpone: () => {} },
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
  'user.sign-in': () => createSignInMachine(new SignInService(fakeSession().session)),
  'user.verify-email': () =>
    createVerifyEmailMachine({
      token: 't',
      verify: () => okAsync({ kind: 'verified-before' }),
      resend: () => okAsync(undefined),
    }),
  'user.confirm-email': () =>
    createConfirmEmailMachine({
      token: 't',
      confirm: () => errAsync(dataError('data:LINK_INVALID', 'not in this spec')),
      current: () => undefined,
    }),
  'user.forgot-password': () => createForgotPasswordMachine({ request: () => okAsync(undefined) }),
  'user.reset-password': () =>
    createResetPasswordMachine({ token: 't', reset: () => okAsync(undefined) }),
  'user.settings': () =>
    createSettingsMachine({
      values: () => ({ held: true, account: undefined, storingFor: undefined }),
      setTheme: () => {},
      storeLocale: () => okAsync(undefined),
      changePassword: () => okAsync(undefined),
      changeEmail: () => okAsync(undefined),
    }),
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

  // A base that does not load fails here, once; the machines then wait for it.
  it("the contract at the branch's base loads", () => {
    expect('problem' in AT_BASE ? AT_BASE.problem : undefined).toBeUndefined()
  })

  it.skipIf('problem' in AT_BASE).each(Object.entries(APP_MACHINES))(
    '%s is the flow of its screen',
    (id, machine) => {
      const flow =
        screens?.screens.find((screen) => screen.id === id)?.flow ??
        expect.unreachable(`a flow of ${id}`)
      const atBase = 'flows' in AT_BASE ? AT_BASE.flows.get(id) : expect.unreachable('a base')
      const { config } = machine()
      const app = projected(config)

      expect(beyondTheSubset(config), `what ${id} does beyond its flow`).toEqual([])
      expect(app).toEqual(
        AHEAD
          ? laggingOf(app, projected(flow), atBase === undefined ? undefined : projected(atBase))
          : projected(flow),
      )
    },
  )
})
