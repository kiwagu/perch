/**
 * What every step of the smoke test shares: a step that runs within its time and prints one
 * line, the checks it makes, and a device's hello that is welcomed.
 */

import type { Result } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { PROTOCOL_VERSION } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { GatewayRoot } from '../src/composition/root'
import type { RunningServer } from '../src/server'

import { SmokeDevice } from './smoke-device'
import type { SignedIn } from './smoke-http'

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

/** Opens a device of the identity: its hello is welcomed, and the welcome comes with it. */
export async function hello(
  base: string,
  opened: Opened,
  { identity, tokens, device: id }: SignedIn,
) {
  const device = await SmokeDevice.open(`${base.replace(/^http/, 'ws')}/sync`)

  opened.devices.push(device)
  device.send({ type: 'hello', protocol: PROTOCOL_VERSION, ...tokens, device: id })

  const welcome = await device.next('welcome')

  check(welcome.identity === identity.id, `welcomed as ${welcome.identity}`)

  return { device, welcome }
}

/** The body of a route's refusal: the code that says why. */
export const refusal = z.object({ code: z.string() })
