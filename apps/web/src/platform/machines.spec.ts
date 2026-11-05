/**
 * Where the app has a machine of its own for a screen, its config is the screen's flow, as each
 * binding is a route the router matches (`routes-router.spec.ts`). The contract check already
 * runs every flow in XState; this holds the app's own machines to theirs, through the
 * engine's comparison (`@workspace/ui-contract/machines`): the same initial state, states,
 * final states, parallel states with the same regions and initial states, events with their
 * targets and guard names, invoke sources, the contract's effects on the same transitions, and
 * what each state renders (`meta.renders`).
 * The app adds actions of its own (an `assign`), and its `input` is the app's, but no
 * mechanism the flow has no counterpart for. On a branch the pre-commit hook sets
 * `CONTRACT_AHEAD=1`: a business commit may change a flow before its implementation, so a
 * machine may lack what its flow added but does nothing the flow does not say, or is still
 * exactly its screen's flow at the branch's base (`CONTRACT_AHEAD_BASE`) or at the branch's
 * HEAD, the contract the app was built from (`CONTRACT_AHEAD_HEAD`,
 * `__fixtures__/machine-flows.ts`); `bun run check` and a commit on `main` hold every machine
 * to its whole flow.
 */

import { join } from 'node:path'

import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { formatProblem, loadScreens } from '@workspace/ui-contract'
import { beyondTheSubset, projected } from '@workspace/ui-contract/machines'

import { NOTHING_SEEN } from '../features/app-shell/application/setting-writes'
import { createShellMachine } from '../features/app-shell/application/shell-machine'
import { createDevicesMachine } from '../features/device/application/devices.machine'
import { createOrganisationMachine } from '../features/organisation/application/organisation.machine'
import { createConfirmEmailMachine } from '../features/user/application/confirm-email.machine'
import { createDeleteAccountMachine } from '../features/user/application/delete-account.machine'
import { createForgotPasswordMachine } from '../features/user/application/forgot-password.machine'
import { createProfileMachine } from '../features/user/application/profile.machine'
import { createResetPasswordMachine } from '../features/user/application/reset-password.machine'
import { createSettingsMachine } from '../features/user/application/settings/settings-machine'
import { SignInService } from '../features/user/application/sign-in.service'
import { createSignInMachine } from '../features/user/application/sign-in-machine'
import { createVerifyEmailMachine } from '../features/user/application/verify-email.machine'

import { AHEAD, flowsAt, heldFlow } from './__fixtures__/machine-flows'
import { fakeSession } from './__fixtures__/session'

const ROOT = join(import.meta.dirname, '../../../..')

/** The merge base of the branch with `main`, which the pre-commit hook names on a branch. */
const BASE = process.env['CONTRACT_AHEAD_BASE']

/**
 * The commit the branch is at, which the hook names too rather than this spec reading git's
 * HEAD itself: the test cache keys on the name, so a pass never carries into a later state whose
 * files are the same but whose HEAD holds another contract.
 */
const HEAD = process.env['CONTRACT_AHEAD_HEAD']

const AT_BASE = flowsAt(BASE, ROOT)
const AT_HEAD = flowsAt(HEAD, ROOT)

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
      followTheme: () => {},
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
  'user.delete-account': () =>
    createDeleteAccountMachine({ token: 't', deleteAccount: () => okAsync(undefined) }),
  'user.settings': () =>
    createSettingsMachine({
      values: () => ({ held: true, account: undefined, storingFor: undefined }),
      setTheme: () => {},
      storeTheme: () => okAsync(undefined),
      storeLocale: () => okAsync(undefined),
      changePassword: () => okAsync(undefined),
      changeEmail: () => okAsync(undefined),
      requestAccountDeletion: () => okAsync(undefined),
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

/** The flow of a sample screen whose save leads where `after` says once it succeeds. */
const sample = (after: string) =>
  projected({
    initial: 'editing',
    states: {
      editing: { on: { 'sample.save-button': { target: 'saving' } } },
      saving: { invoke: { src: 'sample.save', onDone: { target: after } } },
      done: { type: 'final' },
      checking: { on: { 'sample.save-button': { target: 'saving' } } },
    },
  })

describe('the flow a machine is held to on a branch', () => {
  // `done` at the base, `checking` at the branch's HEAD, `editing` in the business commit taken.
  const atBase = sample('done')
  const atHead = sample('checking')
  const now = sample('editing')

  it('is its flow now when the machine has built it', () => {
    expect(heldFlow(now, now, [atHead, atBase])).toEqual(now)
  })

  it("is the flow at the branch's HEAD when the machine still is that one", () => {
    expect(heldFlow(atHead, now, [atHead, atBase])).toEqual(atHead)
    expect(heldFlow(atHead, now, [atHead, undefined])).toEqual(atHead)
  })

  it("is the flow at the branch's base when the machine still is that one", () => {
    expect(heldFlow(atBase, now, [atHead, atBase])).toEqual(atBase)
    expect(heldFlow(atBase, now, [undefined, atBase])).toEqual(atBase)
  })

  it('is something the machine does not equal when it is none of them', () => {
    const elsewhere = sample('saving')

    expect(heldFlow(elsewhere, now, [atHead, atBase])).not.toEqual(elsewhere)
  })

  it('is no earlier flow the machine does not name', () => {
    expect(heldFlow(atHead, now, [undefined, atBase])).not.toEqual(atHead)
    expect(heldFlow(atHead, now, [])).not.toEqual(atHead)
  })
})

describe('the machines of the app', () => {
  it('read the screens of the contract', () => {
    expect(problems.map(formatProblem)).toEqual([])
  })

  // A base or a HEAD that does not load fails here, once; the machines then wait for it.
  it("the contract at the branch's base loads", () => {
    expect('problem' in AT_BASE ? AT_BASE.problem : undefined).toBeUndefined()
  })

  it("the contract at the branch's HEAD loads", () => {
    expect('problem' in AT_HEAD ? AT_HEAD.problem : undefined).toBeUndefined()
  })

  it.skipIf('problem' in AT_BASE || 'problem' in AT_HEAD).each(Object.entries(APP_MACHINES))(
    '%s is the flow of its screen',
    (id, machine) => {
      const flow =
        screens?.screens.find((screen) => screen.id === id)?.flow ??
        expect.unreachable(`a flow of ${id}`)
      const earlier = [AT_HEAD, AT_BASE].map((at) => {
        const was = 'flows' in at ? at.flows.get(id) : expect.unreachable('an earlier contract')

        return was === undefined ? undefined : projected(was)
      })
      const { config } = machine()
      const app = projected(config)

      expect(beyondTheSubset(config), `what ${id} does beyond its flow`).toEqual([])
      expect(app).toEqual(AHEAD ? heldFlow(app, projected(flow), earlier) : projected(flow))
    },
  )
})
