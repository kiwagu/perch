/**
 * A passkey the gateway issued for an account, for the probes of the action that names one: the
 * sender adds it as a device does, through the registration's options and the answer of an
 * authenticator in software made for the stand's front.
 */

import { expect } from 'vitest'

import { z } from '@workspace/zod'

import { SoftwareAuthenticator } from './software-authenticator'
import type { Account, Stand } from './stand'

const ceremony = z.object({
  options: z.record(z.string(), z.unknown()),
  challenge: z.string().min(1),
})

const listed = z.array(z.object({ id: z.string().min(1) }))

/** The id of a passkey `sender` just added to its account, which it may remove. */
export async function passkeyOf(stand: Stand, sender: Account): Promise<string> {
  const front = new URL(stand.publicUrl)
  const held = new SoftwareAuthenticator({ rpId: front.hostname, origin: front.origin })
  const started = await stand.ask({ method: 'POST', path: '/passkeys/options', as: sender })

  if (started.status !== 200) {
    throw new Error(`the sender's registration did not start: ${started.status}`)
  }

  const { options, challenge } = ceremony.parse(started.body)
  const added = await stand.ask({
    method: 'POST',
    path: '/passkeys',
    as: sender,
    body: { response: held.create(options), challenge },
  })

  if (added.status !== 201) {
    throw new Error(`the sender's passkey was not added: ${added.status}`)
  }

  const passkeys = listed.parse(
    (await stand.ask({ method: 'GET', path: '/passkeys', as: sender })).body,
  )

  return passkeys.at(-1)?.id ?? expect.unreachable('the passkey added')
}
