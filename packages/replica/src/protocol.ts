import { err, ok, type Result } from 'neverthrow'

import { TENANT_ROLES } from '@workspace/kernel'
import { z } from '@workspace/zod'

export const PROTOCOL_VERSION = 4

/**
 * Close codes of the gateway: a message the protocol refuses, keys it refuses, a region of
 * somebody else, a hello that did not come in time, a sign-out, and a device signed out from
 * another device (one device, or every device of the identity).
 */
export const CLOSE = {
  protocol: 4400,
  unauthorized: 4401,
  forbidden: 4403,
  timeout: 4408,
  signedOut: 4000,
  revoked: 4001,
} as const

/** The id a device names itself with: the browser's own stable id, minted on first use. */
export const deviceId = z.string().min(1).max(64)

export const MAX_PUSH_UPDATES = 256

function toBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }

  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)

  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** Loro bytes travel as base64 text inside JSON messages. */
const bytes = z.codec(z.base64(), z.instanceof(Uint8Array), {
  decode: fromBase64,
  encode: toBase64,
})

const region = z.string().min(1).max(200)

const head = z.int().nonnegative()

const batch = z.int().positive()

export const rejectReason = z.enum([
  'malformed',
  'pending-dependencies',
  'foreign-table',
  'foreign-owner',
  'forbidden-action',
  'invalid-record',
])

export const compactionOutcome = z.enum(['accepted', 'stale', 'beyond-head', 'version-mismatch'])

/** An identity's role in an organisation. */
export const tenantRole = z.enum(TENANT_ROLES)

/** An organisation an identity belongs to, and its role there, as the gateway tells a device. */
export const membership = z.object({
  tenant: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  role: tenantRole,
})

const regionHead = z.object({ region, head })

export const clientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocol: z.literal(PROTOCOL_VERSION),
    access: z.string().min(1),
    refresh: z.string().min(1).optional(),
    /**
     * The device saying hello. The gateway refuses a hello without it (4400); it stays optional
     * here only until every client sends it.
     */
    device: deviceId.optional(),
  }),
  z.object({ type: z.literal('subscribe'), region, vv: bytes.nullable() }),
  z.object({ type: z.literal('pull'), region, vv: bytes }),
  z.object({
    type: z.literal('push'),
    region,
    batch,
    updates: z.array(bytes).min(1).max(MAX_PUSH_UPDATES),
  }),
  z.object({ type: z.literal('probe'), regions: z.array(region).max(64) }),
  z.object({ type: z.literal('compact'), region, covers: head, snapshot: bytes }),
  z.object({ type: z.literal('sign-out'), scope: z.literal('device') }),
])

export const serverMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    identity: z.string(),
    /** The identity's private region and the region of each organisation it belongs to. */
    regions: z.array(regionHead),
    memberships: z.array(membership),
    time: z.int(),
  }),
  /** The identity's memberships changed: the regions the device may name changed with them. */
  z.object({ type: z.literal('memberships'), memberships: z.array(membership) }),
  z.object({ type: z.literal('tokens'), access: z.string().min(1), refresh: z.string().min(1) }),
  z.object({ type: z.literal('updates'), region, bytes, head, snapshot: z.boolean() }),
  z.object({ type: z.literal('ack'), region, batch, head, compact: z.boolean() }),
  z.object({ type: z.literal('reject'), region, batch, reason: rejectReason, detail: z.string() }),
  z.object({ type: z.literal('heads'), regions: z.array(regionHead), time: z.int() }),
  z.object({ type: z.literal('compaction'), region, covers: head, outcome: compactionOutcome }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['protocol', 'unauthorized', 'forbidden-region', 'internal']),
    message: z.string(),
  }),
])

export type ClientMessage = z.output<typeof clientMessage>

export type ServerMessage = z.output<typeof serverMessage>

export type RejectReason = z.output<typeof rejectReason>

export type CompactionOutcome = z.output<typeof compactionOutcome>

export type Membership = z.output<typeof membership>

export type TenantRole = z.output<typeof tenantRole>

export interface ProtocolError {
  readonly code: 'protocol'
  readonly message: string
}

type MessageSchema = typeof clientMessage | typeof serverMessage

export function encodeMessage(schema: typeof clientMessage, message: ClientMessage): string
export function encodeMessage(schema: typeof serverMessage, message: ServerMessage): string
export function encodeMessage(
  schema: MessageSchema,
  message: ClientMessage | ServerMessage,
): string {
  return JSON.stringify(z.encode(schema, message))
}

export function decodeMessage(
  schema: typeof clientMessage,
  text: string,
): Result<ClientMessage, ProtocolError>
export function decodeMessage(
  schema: typeof serverMessage,
  text: string,
): Result<ServerMessage, ProtocolError>
export function decodeMessage(
  schema: z.ZodType<ClientMessage | ServerMessage>,
  text: string,
): Result<ClientMessage | ServerMessage, ProtocolError> {
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch {
    return err({ code: 'protocol', message: 'the message is not JSON' })
  }

  const parsed = schema.safeDecode(json)

  return parsed.success
    ? ok(parsed.data)
    : err({
        code: 'protocol',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      })
}
