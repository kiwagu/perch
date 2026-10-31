/**
 * What every step of the smoke test shares: a step that runs within its time and prints one
 * line, the checks it makes, a device's hello that is welcomed, and the updates it takes in.
 */

import type { Result } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { RegionDoc } from '@workspace/replica'
import { PROTOCOL_VERSION } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { GatewayRoot } from '../../src/composition/root'
import type { RunningServer } from '../../src/server'

import { SmokeDevice } from './device'
import type { SignedIn } from './http'

const STEP_TIMEOUT_MS = 5_000

/** What the run opened, to close at its end whatever happened. */
export interface Opened {
  root?: GatewayRoot
  server?: RunningServer
  readonly devices: SmokeDevice[]
}

export function check(condition: boolean, failure: string): void {
  if (!condition) {
    throw new Error(failure)
  }
}

export function unwrap<T>(result: Result<T, DataError>): T {
  return result.match(
    (value) => value,
    (error) => {
      throw new Error(`${error.code} ${error.message}`)
    },
  )
}

function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${STEP_TIMEOUT_MS / 1000} s`)),
      STEP_TIMEOUT_MS,
    )
  })

  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** Runs one step within the step time and prints whether it passed; a failure ends the run. */
export async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    const value = await within(run())

    console.log(`smoke: ok   ${name}`)

    return value
  } catch (cause) {
    console.log(`smoke: FAIL ${name}: ${cause instanceof Error ? cause.message : String(cause)}`)

    throw cause
  }
}

/** Opens a socket to the sync endpoint and says hello as `signedIn`, with its session token. */
async function sayHello(base: string, opened: Opened, { token, device: id }: SignedIn) {
  const device = await SmokeDevice.open(`${base.replace(/^http/, 'ws')}/sync`)

  opened.devices.push(device)
  device.send({ type: 'hello', protocol: PROTOCOL_VERSION, token, device: id })

  return device
}

/** Opens a device of the identity: its hello is welcomed, and the welcome comes with it. */
export async function hello(base: string, opened: Opened, signedIn: SignedIn) {
  const device = await sayHello(base, opened, signedIn)
  const welcome = await device.next('welcome')

  check(welcome.identity === signedIn.identity.id, `welcomed as ${welcome.identity}`)

  return { device, welcome }
}

/** Says hello as `signedIn` from its device and settles with how the gateway closed the socket. */
export async function refusedHello(base: string, opened: Opened, signedIn: SignedIn) {
  return (await sayHello(base, opened, signedIn)).closed
}

/** Takes the device's next `updates` into its document; answers with the update's head. */
export async function takeUpdates(
  device: SmokeDevice,
  doc: RegionDoc,
  snapshot: boolean,
): Promise<number> {
  const updates = await device.next('updates')

  check(updates.snapshot === snapshot, `updates with snapshot ${updates.snapshot}`)
  unwrap(await doc.importRemote(updates.bytes, updates.head))

  return updates.head
}

/** The body of a route's refusal: the code that says why. */
export const refusal = z.object({ code: z.string() })
