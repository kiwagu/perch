/**
 * A passkey authenticator in software, for the specs: one credential, an ES256 key pair made with
 * `node:crypto`, that answers a registration's options with a `none` attestation (its attestation
 * object and the credential's COSE key written by a minimal CBOR writer) and a sign-in's options
 * with an assertion signed over `authData ‖ sha256(clientDataJSON)`, as a browser hands them to the
 * page. Whether it verified its user (a PIN, a fingerprint) is a switch of each answer. It answers
 * only options of the relying party it was made for (`Front`), as a browser does.
 */

import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto'

import { z } from '@workspace/zod'

/** The front a passkey is bound to: its host (the relying party's id) and its origin. */
export interface Front {
  readonly rpId: string
  readonly origin: string
}

/** Whether the authenticator verified its user for an answer; it did unless named. */
export interface Unlocked {
  readonly userVerified?: boolean
}

/** A registration's answer, as `navigator.credentials.create` hands it to the page, in JSON. */
export interface RegistrationResponse {
  readonly id: string
  readonly rawId: string
  readonly type: 'public-key'
  readonly response: {
    readonly clientDataJSON: string
    readonly attestationObject: string
    readonly transports: readonly string[]
  }
  readonly clientExtensionResults: Readonly<Record<string, never>>
  readonly authenticatorAttachment: 'platform'
}

/** A sign-in's answer, as `navigator.credentials.get` hands it to the page, in JSON. */
export interface AuthenticationResponse {
  readonly id: string
  readonly rawId: string
  readonly type: 'public-key'
  readonly response: {
    readonly clientDataJSON: string
    readonly authenticatorData: string
    readonly signature: string
    readonly userHandle?: string
  }
  readonly clientExtensionResults: Readonly<Record<string, never>>
  readonly authenticatorAttachment: 'platform'
}

/** A registration's options, as far as an authenticator reads them. */
const creationOptions = z.object({
  challenge: z.string().min(1),
  rp: z.object({ id: z.string().min(1) }),
  user: z.object({ id: z.string().min(1) }),
})

/** A sign-in's options, as far as an authenticator reads them. */
const requestOptions = z.object({
  challenge: z.string().min(1),
  rpId: z.string().min(1),
  allowCredentials: z.array(z.object({ id: z.string() })).optional(),
})

/** The public key's coordinates, as `node:crypto` exports an EC key. */
const ecJwk = z.object({ x: z.string().min(1), y: z.string().min(1) })

/** A value the CBOR writer writes: an integer, a text, bytes, or a map of them. */
type Cbor = number | string | Uint8Array | ReadonlyMap<number | string, Cbor>

/** Flags of an authenticator's data: the user present, verified, and a credential attested. */
const USER_PRESENT = 0x01
const USER_VERIFIED = 0x04
const ATTESTED = 0x40

/** COSE: an EC2 key (`kty`), of ES256 (`alg`), on P-256 (`crv`). */
const COSE_EC2 = 2
const COSE_ES256 = -7
const COSE_P256 = 1

const concat = (...parts: readonly Uint8Array[]): Uint8Array => Buffer.concat(parts)

const sha256 = (data: Uint8Array | string): Uint8Array => createHash('sha256').update(data).digest()

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

/** The head of a CBOR item of `major` type and `value`, its argument in the shortest form. */
function head(major: number, value: number): Uint8Array {
  if (value < 24) {
    return Uint8Array.of((major << 5) | value)
  }

  if (value < 0x100) {
    return Uint8Array.of((major << 5) | 24, value)
  }

  if (value < 0x10000) {
    return Uint8Array.of((major << 5) | 25, value >> 8, value & 0xff)
  }

  throw new Error(`the CBOR writer takes arguments below 65536, not ${value}`)
}

/**
 * `value` in CBOR, each argument in its shortest form and a map's entries in their order, as the
 * verifier writes a key back when it measures it.
 */
function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value)
  }

  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8')

    return concat(head(3, text.length), text)
  }

  if (value instanceof Uint8Array) {
    return concat(head(2, value.length), value)
  }

  return concat(
    head(5, value.size),
    ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]),
  )
}

/** The client's data of a ceremony of `type`, as the browser writes it, in base64url. */
const clientData = (type: string, challenge: string, origin: string): Uint8Array =>
  Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8')

/** One passkey made in software: the authenticator that holds it. */
export class SoftwareAuthenticator {
  readonly #front: Front
  readonly #privateKey: KeyObject
  readonly #publicKey: KeyObject
  readonly #credential: Uint8Array = randomBytes(16)
  /** The account's handle the registration named, which a sign-in hands back. */
  #userHandle: string | undefined
  /** The count of its signatures, which each sign-in moves on. */
  #counter = 0

  constructor(front: Front) {
    this.#front = front

    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

    this.#privateKey = privateKey
    this.#publicKey = publicKey
  }

  /** The credential's id, as a sign-in names it (`response.id`). */
  get id(): string {
    return base64url(this.#credential)
  }

  /** Answers a registration's `options` with the credential, its key and a `none` attestation. */
  create(options: unknown, unlocked: Unlocked = {}): RegistrationResponse {
    const asked = creationOptions.parse(options)

    if (asked.rp.id !== this.#front.rpId) {
      throw new Error(`the authenticator answers ${this.#front.rpId}, not ${asked.rp.id}`)
    }

    this.#userHandle = asked.user.id

    const { x, y } = ecJwk.parse(this.#publicKey.export({ format: 'jwk' }))
    const key = cbor(
      new Map<number, Cbor>([
        [1, COSE_EC2],
        [3, COSE_ES256],
        [-1, COSE_P256],
        [-2, Buffer.from(x, 'base64url')],
        [-3, Buffer.from(y, 'base64url')],
      ]),
    )
    const length = Uint8Array.of(this.#credential.length >> 8, this.#credential.length & 0xff)
    const authData = concat(
      sha256(this.#front.rpId),
      Uint8Array.of(this.#flags(unlocked) | ATTESTED),
      new Uint8Array(4),
      new Uint8Array(16),
      length,
      this.#credential,
      key,
    )
    const attestation = cbor(
      new Map<string, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    )

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: base64url(
          clientData('webauthn.create', asked.challenge, this.#front.origin),
        ),
        attestationObject: base64url(attestation),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /** Answers a sign-in's `options` with an assertion of the credential, its count moved on. */
  get(options: unknown, unlocked: Unlocked = {}): AuthenticationResponse {
    const asked = requestOptions.parse(options)

    if (asked.rpId !== this.#front.rpId) {
      throw new Error(`the authenticator answers ${this.#front.rpId}, not ${asked.rpId}`)
    }

    if (
      asked.allowCredentials !== undefined &&
      asked.allowCredentials.length > 0 &&
      !asked.allowCredentials.some((allowed) => allowed.id === this.id)
    ) {
      throw new Error('the options allow no credential of this authenticator')
    }

    this.#counter++

    const counter = Buffer.alloc(4)

    counter.writeUInt32BE(this.#counter)

    const authData = concat(sha256(this.#front.rpId), Uint8Array.of(this.#flags(unlocked)), counter)
    const data = clientData('webauthn.get', asked.challenge, this.#front.origin)
    const signature = sign('sha256', concat(authData, sha256(data)), this.#privateKey)

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: base64url(data),
        authenticatorData: base64url(authData),
        signature: base64url(signature),
        ...(this.#userHandle === undefined ? {} : { userHandle: this.#userHandle }),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  #flags({ userVerified = true }: Unlocked): number {
    return USER_PRESENT | (userVerified ? USER_VERIFIED : 0)
  }
}
