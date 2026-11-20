/**
 * The gateway held to the platform's actions. Each platform action the contract declares is a
 * route of the gateway or the client's own, and each route the gateway serves is an action's or
 * has its reason. Each bound a parameter of an action states (a length, a pattern, a format) is a
 * bound of its route: a value just past it is refused, with the code the contract attributes to
 * that parameter for that bound where it attributes one, and a value just inside it is answered
 * otherwise than the one past it, with that code or none. The text of an id is held apart from
 * the record it names: past its bound it is refused before any record is looked for, an id of the
 * form the gateway issues is not, and one it issued for a record is done.
 *
 * The gateway is asked over HTTP as a device asks it, every other parameter of a request valid.
 * The contract is read here and nowhere in the gateway's own code: this is where the two meet. The
 * gateway takes its bounds from the kernel's generated values, so they are held to the contract
 * those were emitted from: the contract now, or on a branch (`CONTRACT_AHEAD=1`, set by the
 * pre-commit hook) the contract at the branch's merge base or at the commit the branch is at, so a
 * business commit that changes a bound does not fail this spec before the implementation emits the
 * values again (`held-contract.ts`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  attributedCodes,
  FIELD_CODE_SUFFIXES,
  loadContract,
  parameterValueOf,
} from '@workspace/ui-contract'

import { heldContract } from './__fixtures__/held-contract'
import { census, stale, unnamed } from './__fixtures__/platform-census'
import { idsOf } from './__fixtures__/platform-ids'
import { type Param, requestFor, type World, worldFor } from './__fixtures__/platform-requests'
import {
  ACTION_ROUTES,
  CLIENT_ONLY,
  NO_ACTION_ROUTES,
  SERVER_ROUTES,
} from './__fixtures__/platform-routes'
import { boundsOf, isChecked, isIssued } from './__fixtures__/platform-values'
import { type Account, openStand, type Stand } from './__fixtures__/stand'
import { MOUNT_PATHS } from './auth/auth-handler'
import { DEVICE_PATHS } from './auth/device.routes'
import { CONSOLE_PATHS } from './console'
import { INVITATION_PATHS } from './tenants/invitation-routes'
import { ORGANISATION_PATHS } from './tenants/organisation-routes'

/**
 * The code of a request that does not follow its schema, which the contract attributes to no
 * parameter: the answer to the text of an id past its bound.
 */
const SHAPE_REFUSAL = 'bad-request'

/**
 * The actions whose route takes the id's form (its entity's schema) before it looks for the record,
 * so any text that is not an issued id of that form is refused as a request that does not follow
 * its schema, whatever its length.
 */
const FORM_CHECKED = [
  'organisations.set-role',
  'organisations.remove',
  'organisations.revoke-invitation',
]

const ROOT = join(import.meta.dirname, '../../..')
const { contract, problems } = loadContract(ROOT)

if (contract === undefined) {
  throw new Error(`the contract does not load: ${JSON.stringify(problems)}`)
}

const { platform } = contract.screens

/** The kernel's generated values, from which the gateway takes every bound. */
const KERNEL_VALUES = join(ROOT, 'packages/kernel/src/contract-values.gen.ts')

/** The contract the bounds of the parameters are held to. */
const held = heldContract({
  committed: readFileSync(KERNEL_VALUES, 'utf8'),
  root: ROOT,
  env: process.env,
})
const heldPlatform = held.screens.platform

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

/** Every parameter of every routed action, as the held contract declares it and resolves it. */
const parameters = Object.keys(ACTION_ROUTES).map((action) => {
  const entries = Object.entries(heldPlatform.actions[action]?.params ?? {}).map(
    ([name, declared]) => ({
      name,
      declared,
      ref: declared.value ?? name,
      value: parameterValueOf(bound(action), name, heldPlatform, held.model),
    }),
  )
  const params: Param[] = entries.map(({ name, declared, value }) => ({
    name,
    ref: declared.value,
    optional: declared.optional === true,
    first: value.enum?.[0],
    type: value.type,
  }))

  return { action, params, entries }
})

/** Each bound a parameter states of the text it takes, with what the probes need of it. */
const probes = parameters.flatMap(({ action, params, entries }) =>
  entries
    .filter(({ ref }) => !isIssued(ref))
    .flatMap(({ name, ref, value }) =>
      boundsOf(ref, value).map((limit) => ({ action, params, param: name, ref, limit })),
    ),
)

/** The parameters whose value names a record the gateway issued, with the bounds of its text. */
const idProbes = parameters.flatMap(({ action, params, entries }) =>
  entries
    .filter(({ ref }) => isIssued(ref))
    .map(({ name, ref, value }) => ({ action, params, param: name, bounds: boundsOf(ref, value) })),
)

describe('the bounds of the parameters', () => {
  it('has bounds to hold the gateway to', () => {
    expect(probes.length).toBeGreaterThan(0)
    expect(idProbes.length).toBeGreaterThan(0)
  })

  it.each(probes)(
    'holds $action $param to its $limit.name',
    async ({ action, params, param, ref, limit }) => {
      const wire = ACTION_ROUTES[action] ?? expect.unreachable('a routed action')
      const roles = heldPlatform.actions[action]?.roles
      const ask = async (value: string | undefined) =>
        stand.ask(
          requestFor(action, wire, params, await worldFor(stand, wire, roles), { param, value }),
        )
      // `rejected` names any constraint and `taken` none, so neither says what this bound is.
      const suffixes = FIELD_CODE_SUFFIXES.filter(
        ({ suffix, holds }) =>
          suffix !== 'taken' && suffix !== 'rejected' && holds(limit.constraint),
      ).map(({ suffix }) => `-${suffix}`)
      const code = (attributedCodes(bound(action), heldPlatform)[param] ?? []).find((each) =>
        suffixes.some((suffix) => each.endsWith(suffix)),
      )
      const past = await ask(limit.past)

      expect(past.status).toBeGreaterThanOrEqual(400)
      expect(past.status).toBeLessThan(500)

      if (code !== undefined) {
        expect(past.code).toBe(code)
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

  // The text of an id is held apart from the record it names: a text past the bound is refused
  // before any record is looked for, with the code of a request that does not follow its schema,
  // the contract attributing none; one of the form the gateway issues, known or not, is not.
  it.each(idProbes)(
    'holds $action $param to the length of an id',
    async ({ action, params, param, bounds }) => {
      const wire = ACTION_ROUTES[action] ?? expect.unreachable('a routed action')
      const roles = heldPlatform.actions[action]?.roles
      const ids =
        idsOf(action) ?? expect.unreachable(`name the ids of ${action} in platform-ids.ts`)
      const asking = async (id: (stand: Stand, world: World) => string | Promise<string>) => {
        const world = await worldFor(stand, wire, roles)

        return stand.ask(
          requestFor(action, wire, params, world, { param, value: await id(stand, world) }),
        )
      }
      const longest = bounds.find(({ constraint }) => constraint.maxLength !== undefined)
      const shortest = bounds.find(({ constraint }) => constraint.minLength !== undefined)
      const past = await asking(() => longest?.past ?? expect.unreachable('a longest id'))

      expect({ status: past.status, code: past.code }).toEqual({ status: 400, code: SHAPE_REFUSAL })

      // No path carries an empty id: nothing answers it.
      const empty = await asking(() => shortest?.past ?? expect.unreachable('a shortest id'))

      expect(empty.status).toBe(404)

      const unknown = await asking(() => ids.unknown())

      expect(unknown.status).toBeLessThan(500)
      expect(unknown.code).not.toBe(SHAPE_REFUSAL)

      // A text of the bound's length is no id of the form: where the route takes the form before it
      // looks for the record, it is refused as the text past the bound is.
      if (!FORM_CHECKED.includes(action)) {
        const atBound = await asking(() => longest?.inside ?? expect.unreachable('a longest id'))

        expect(atBound.status).toBeLessThan(500)
        expect(atBound.code).not.toBe(SHAPE_REFUSAL)
      }

      const done = await asking((owner, world) => ids.issued(owner, world))

      expect(done.status).toBeGreaterThanOrEqual(200)
      expect(done.status).toBeLessThan(300)
    },
  )
})
