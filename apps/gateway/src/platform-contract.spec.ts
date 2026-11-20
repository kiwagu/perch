/**
 * The gateway held to the platform's actions. Each platform action the contract declares is a
 * route of the gateway or the client's own, and each route the gateway serves is an action's or
 * has its reason. Each bound a parameter of an action states (a length, a pattern, a format) is a
 * bound of its route: a value just past it is refused, with the code the contract attributes to
 * that parameter for that bound where it attributes one, and a value just inside it is answered
 * otherwise than the one past it, with that code or none.
 *
 * The gateway is asked over HTTP as a device asks it, every other parameter of a request valid.
 * The contract is read here and nowhere in the gateway's own code: this is where the two meet.
 */

import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  attributedCodes,
  FIELD_CODE_SUFFIXES,
  loadContract,
  parameterValueOf,
} from '@workspace/ui-contract'

import { type Param, requestFor, type Wire, worldFor } from './__fixtures__/platform-requests'
import { boundsOf, isChecked, isIssued } from './__fixtures__/platform-values'
import { type Account, openStand, type Stand } from './__fixtures__/stand'
import { MOUNT_PATHS } from './auth/auth-handler'
import { DEVICE_PATHS } from './auth/device.routes'
import { CONSOLE_PATHS } from './console'
import { INVITATION_PATHS } from './tenants/invitation-routes'
import { ORGANISATION_PATHS } from './tenants/organisation-routes'

/** Where each platform action is served; the actions the client answers on its own are below. */
const ACTION_ROUTES: Readonly<Record<string, Wire>> = {
  'sign-up': { method: 'POST', path: '/auth/sign-up/email' },
  'sign-in': { method: 'POST', path: '/auth/sign-in/email' },
  'verify-email': { method: 'POST', path: '/auth/verify-email' },
  'resend-verification': { method: 'POST', path: '/auth/send-verification-email' },
  'request-password-reset': { method: 'POST', path: '/auth/request-password-reset' },
  'reset-password': { method: 'POST', path: '/auth/reset-password' },
  'change-password': { method: 'POST', path: '/auth/change-password' },
  'change-email': { method: 'POST', path: '/auth/change-email' },
  'confirm-email': { method: 'POST', path: '/auth/confirm-email' },
  'request-account-deletion': { method: 'POST', path: '/auth/request-account-deletion' },
  'delete-account': { method: 'POST', path: '/auth/delete-account' },
  'sign-out': { method: 'POST', path: '/auth/sign-out' },
  'sign-out-everywhere': { method: 'POST', path: '/auth/sign-out-everywhere' },
  'devices.list': { method: 'GET', path: '/devices' },
  'devices.revoke': { method: 'DELETE', path: '/devices/:id', segments: { id: 'device' } },
  'organisations.create': { method: 'POST', path: '/organisations' },
  'organisations.members': { method: 'GET', path: '/organisations/:key/members' },
  'organisations.invite': { method: 'POST', path: '/organisations/:key/invitations' },
  'organisations.invitations': { method: 'GET', path: '/organisations/:key/invitations' },
  'organisations.revoke-invitation': {
    method: 'DELETE',
    path: '/organisations/:key/invitations/:invitation',
  },
  'organisations.set-role': { method: 'PATCH', path: '/organisations/:key/members/:identity' },
  'organisations.remove': { method: 'DELETE', path: '/organisations/:key/members/:identity' },
  'invitations.read': { method: 'POST', path: '/invitations/read' },
  'invitations.mine': { method: 'GET', path: '/invitations' },
  'invitations.accept': { method: 'POST', path: '/invitations/accept' },
  'invitations.decline': { method: 'POST', path: '/invitations/decline' },
  'accounts.list': { method: 'GET', path: '/console/accounts' },
  'accounts.read': { method: 'GET', path: '/console/accounts/:id' },
  'accounts.rename': { method: 'POST', path: '/console/accounts/:id/rename' },
  'accounts.change-email': { method: 'POST', path: '/console/accounts/:id/email' },
  'accounts.ban': { method: 'POST', path: '/console/accounts/:id/ban' },
  'accounts.unban': { method: 'POST', path: '/console/accounts/:id/unban' },
  'accounts.revoke-sessions': { method: 'POST', path: '/console/accounts/:id/sign-out' },
  'accounts.send-reset': { method: 'POST', path: '/console/accounts/:id/reset' },
  'accounts.resend-verification': { method: 'POST', path: '/console/accounts/:id/verification' },
  'accounts.remove': { method: 'POST', path: '/console/accounts/:id/removal' },
}

/** The actions the client answers on its own: no request of the gateway is made for them. */
const CLIENT_ONLY: readonly string[] = [
  'theme.set',
  'reload',
  'install.prompt',
  'install.postpone',
  'organisations.select',
  'organisations.copy-invitation',
]

/** The routes the gateway serves that no platform action names, each with its reason. */
const NO_ACTION_ROUTES: Readonly<Record<string, string>> = {
  'GET /health': 'the liveness answer of the server: no screen asks it',
  'GET /sync': "the upgrade to a device's sync connection, which the sync protocol carries",
  'GET /organisations': 'Contract gap: the memberships read has no platform action',
}

/** The routes the server answers itself, before any module is asked. */
const SERVER_ROUTES = ['GET /health', 'GET /sync']

const ROOT = join(import.meta.dirname, '../../..')
const { contract, problems } = loadContract(ROOT)

if (contract === undefined) {
  throw new Error(`the contract does not load: ${JSON.stringify(problems)}`)
}

const { platform } = contract.screens
const { model } = contract

/** How a binding names a platform action: the engine reads actions as `platform.<name>`. */
const bound = (action: string): string => `platform.${action}`

const routed = (action: string): boolean => Object.hasOwn(ACTION_ROUTES, action)

let stand: Stand

// Opening the gateway takes a few embedded databases and sign-ups, slow on a busy host.
beforeAll(async () => {
  stand = await openStand()
}, 30_000)

afterAll(async () => {
  await stand.close()
})

/** Every path the route modules list. */
const PATHS = [
  ...DEVICE_PATHS,
  ...ORGANISATION_PATHS,
  ...INVITATION_PATHS,
  ...CONSOLE_PATHS,
  ...MOUNT_PATHS,
]

/** The routes the actions and the reasons name, each as `METHOD path`. */
const named = [
  ...Object.values(ACTION_ROUTES).map(({ method, path }) => `${method} ${path}`),
  ...Object.keys(NO_ACTION_ROUTES),
]

/** The routes of `served` no action and no reason names. */
const unnamed = (served: readonly string[]): string[] =>
  served.filter((route) => !named.includes(route))

/** The routes an action or a reason names that `served` lacks, the server's own aside. */
const stale = (served: readonly string[]): string[] =>
  named.filter((route) => !served.includes(route) && !SERVER_ROUTES.includes(route))

/**
 * The `Allow` header the server answers a method no route takes with, as the operator asks it of
 * a path of a module's list, its parameters given a text.
 */
const allowedAt = (operator: Account) => async (path: string) =>
  (
    await stand.ask({
      method: 'PURGE',
      path: path.replace(/:key/g, 'probe').replace(/:\w+/g, 'x'),
      as: operator,
    })
  ).allow

/** The routes the paths answer, each as `METHOD path`, and the paths that answer none. */
async function census(
  paths: readonly string[],
  allow: (path: string) => Promise<string | null>,
): Promise<{ served: string[]; unserved: string[] }> {
  const served: string[] = []
  const unserved: string[] = []

  for (const path of paths) {
    const methods = ((await allow(path)) ?? '').split(', ').filter((method) => method !== '')

    unserved.push(...(methods.length === 0 ? [path] : []))
    served.push(...methods.map((method) => `${method} ${path}`))
  }

  return { served, unserved }
}

describe('the platform actions and the routes', () => {
  const declared = Object.keys(platform.actions)

  it("names each platform action as a route or as the client's own, never both", () => {
    expect(declared.filter((action) => !routed(action) && !CLIENT_ONLY.includes(action))).toEqual(
      [],
    )
    expect(declared.filter((action) => routed(action) && CLIENT_ONLY.includes(action))).toEqual([])
  })

  it('names only platform actions', () => {
    expect(
      [...Object.keys(ACTION_ROUTES), ...CLIENT_ONLY].filter(
        (action) => !declared.includes(action),
      ),
    ).toEqual([])
  })

  it('answers the routes of the server itself', async () => {
    expect((await stand.ask({ method: 'GET', path: '/health' })).status).toBe(200)
    // Not an upgrade: the server asks for one.
    expect((await stand.ask({ method: 'GET', path: '/sync' })).status).toBe(426)
    expect(SERVER_ROUTES.filter((route) => !(route in NO_ACTION_ROUTES))).toEqual([])
  })

  it('serves each route an action names, and no route without an action or a reason', async () => {
    const { served, unserved } = await census(PATHS, allowedAt(await stand.operator()))

    // A path the modules list is one they answer.
    expect(unserved).toEqual([])
    expect(unnamed(served)).toEqual([])
    expect(stale(served)).toEqual([])
  })

  it('asks an action or a reason of a route a module gains', async () => {
    const operator = await stand.operator()
    const gained = '/devices/:id/alias'
    const { served } = await census([...PATHS, gained], async (path) =>
      path === gained ? 'GET' : allowedAt(operator)(path),
    )

    expect(unnamed(served)).toEqual([`GET ${gained}`])
  })
})

/** Every parameter of every routed action, as the contract declares it and resolves its value. */
const parameters = Object.keys(ACTION_ROUTES).map((action) => ({
  action,
  entries: Object.entries(platform.actions[action]?.params ?? {}).map(([name, declared]) => ({
    name,
    declared,
    value: parameterValueOf(bound(action), name, platform, model),
  })),
}))

/** Each bound each parameter of a routed action states, with what the probes need of it. */
const probes = parameters.flatMap(({ action, entries }) => {
  const params: Param[] = entries.map(({ name, declared, value }) => ({
    name,
    ref: declared.value,
    optional: declared.optional === true,
    first: value.enum?.[0],
    type: value.type,
  }))

  return entries.flatMap(({ name, declared, value }) =>
    boundsOf(declared.value ?? name, value).map((limit) => ({
      action,
      params,
      param: name,
      ref: declared.value ?? name,
      limit,
    })),
  )
})

describe('the bounds of the parameters', () => {
  it('has bounds to hold the gateway to', () => {
    expect(probes.length).toBeGreaterThan(0)
  })

  it.each(probes)(
    'holds $action $param to its $limit.name',
    async ({ action, params, param, ref, limit }) => {
      const wire = ACTION_ROUTES[action] ?? expect.unreachable('a routed action')
      const roles = platform.actions[action]?.roles
      const ask = async (value: string | undefined) =>
        stand.ask(
          requestFor(action, wire, params, await worldFor(stand, wire, roles), { param, value }),
        )
      // `rejected` names any constraint and `taken` none, so neither says what this bound is.
      const suffixes = FIELD_CODE_SUFFIXES.filter(
        ({ suffix, holds }) =>
          suffix !== 'taken' && suffix !== 'rejected' && holds(limit.constraint),
      ).map(({ suffix }) => `-${suffix}`)
      const code = (attributedCodes(bound(action), platform)[param] ?? []).find((each) =>
        suffixes.some((suffix) => each.endsWith(suffix)),
      )
      const past = await ask(limit.past)

      expect(past.status).toBeGreaterThanOrEqual(400)
      expect(past.status).toBeLessThan(500)

      if (code !== undefined) {
        expect(past.code).toBe(code)
      }

      // The gateway issues the records such a value names, so a text of the bound's length is never
      // one: only the side past the bound is held.
      if (isIssued(ref)) {
        return
      }

      const inside = await ask(limit.inside)

      expect(inside.status).toBeLessThan(500)

      // A value the account checks is refused past its bounds as a wrong one is: the text inside
      // the bound is not the account's either, so both answer the same.
      if (isChecked(ref)) {
        expect({ status: past.status, code: past.code }).toEqual({
          status: inside.status,
          code: inside.code,
        })

        return
      }

      expect({ status: inside.status, code: inside.code }).not.toEqual({
        status: past.status,
        code: past.code,
      })

      if (code !== undefined) {
        expect(inside.code).not.toBe(code)
      }
    },
  )
})
