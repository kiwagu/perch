import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { Mailbox } from '@workspace/mailbox'

import { call, postCredentials, signUp } from './http'
import { step } from './steps'

/** An answer the stand-in gives a route: its status, its content type and its body as sent. */
interface Canned {
  readonly status: number
  readonly type: string
  readonly body: string
}

const json = (status: number, body: unknown): Canned => ({
  status,
  type: 'application/json',
  body: JSON.stringify(body),
})

/** What marks a session token, an account's email and a link's token wherever they could go. */
const SESSION_TOKEN = 'tok_MARKER_session_0123456789'
const EMAIL = 'marker-ann@example.test'
const LINK_TOKEN = 'MARKER.link.token'
const MARKED = /MARKER|marker-ann/i

/** A session as a sign-in or a first verification answers it: what must never be printed. */
const session = { token: SESSION_TOKEN, user: { id: 'idn_marker', email: EMAIL } }

/**
 * What the stand-in gateway and its mailbox answer: the auth routes by path, as a test sets them,
 * and the mails, which an accepted sign-up adds to as the gateway's mailer would.
 */
const stand: { routes: Map<string, Canned>; mails: unknown[] } = { routes: new Map(), mails: [] }

const verificationMail = {
  id: 'mail-1',
  subject: 'Confirm your email for Perch',
  text: `Open https://localhost/verify-email?token=${LINK_TOKEN} to confirm.`,
  html: '',
  to: [{ address: EMAIL }],
}

// A front that answers as a proxy may: plain text when the gateway behind it is down.
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://stand.test').pathname
    const canned = stand.routes.get(path)

    if (path === '/email') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(stand.mails))

      return
    }

    if (canned !== undefined) {
      if (path === '/auth/sign-up/email' && canned.status === 202) {
        stand.mails.push(verificationMail)
      }

      response.writeHead(canned.status, { 'Content-Type': canned.type })
      response.end(canned.body)

      return
    }

    if (request.url === '/json') {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 'invalid-body' }))

      return
    }

    response.writeHead(502, { 'Content-Type': 'text/plain' })
    response.end('Bad Gateway')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('call', () => {
  it('answers a body that is not JSON as its text, so the step names the status', async () => {
    const answer = await call(base, 'GET', '/down', undefined)

    expect(answer).toMatchObject({ status: 502, body: 'Bad Gateway' })
  })

  it('answers a JSON body parsed', async () => {
    const answer = await call(base, 'GET', '/json', undefined)

    expect(answer).toMatchObject({ status: 400, body: { code: 'invalid-body' } })
  })
})

describe('the sign-up and sign-in of the smoke: nothing of an answer they did not expect is printed', () => {
  const credentials = {
    email: EMAIL,
    password: 'Pass-word-1',
    device: { id: 'smoke-device', label: 'Smoke' },
  }

  beforeEach(() => {
    stand.routes = new Map()
    stand.mails = []
  })

  /** Runs `run` as a step of the smoke, which fails: what the step printed, and its failure. */
  async function failedStep(run: () => Promise<unknown>): Promise<string> {
    const printed: string[] = []
    const keep = (...args: unknown[]): void => {
      printed.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' '))
    }
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(keep),
      vi.spyOn(console, 'error').mockImplementation(keep),
    ]

    try {
      const failure: unknown = await step('a step', run).then(
        () => expect.unreachable('the step passed'),
        (cause: unknown) => cause,
      )

      printed.push(failure instanceof Error ? failure.message : String(failure))
    } finally {
      for (const spy of spies) {
        spy.mockRestore()
      }
    }

    expect(printed.join('\n')).toContain('smoke: FAIL a step')

    return printed.join('\n')
  }

  it('a sign-up answered with a session, as one that signs in would, prints no token or email', async () => {
    stand.routes.set('/auth/sign-up/email', json(200, session))

    const printed = await failedStep(() => signUp(base, new Mailbox(base), credentials))

    expect(printed).toContain('200')
    expect(printed).not.toMatch(MARKED)
  })

  it('a verification answered other than 200, with a session, prints no token, email or link', async () => {
    stand.routes.set('/auth/sign-up/email', { status: 202, type: 'text/plain', body: '' })
    stand.routes.set('/auth/verify-email', json(201, session))

    const printed = await failedStep(() => signUp(base, new Mailbox(base), credentials))

    expect(printed).toContain('201')
    expect(printed).not.toMatch(MARKED)
  })

  it('a verification answered 200 with something other than a session prints none of it', async () => {
    stand.routes.set('/auth/sign-up/email', { status: 202, type: 'text/plain', body: '' })
    stand.routes.set('/auth/verify-email', json(200, { token: SESSION_TOKEN, user: EMAIL }))

    expect(await failedStep(() => signUp(base, new Mailbox(base), credentials))).not.toMatch(MARKED)
  })

  it('a sign-in answered other than 200 prints its status and code, never its body', async () => {
    stand.routes.set('/auth/sign-in/email', {
      status: 500,
      type: 'text/plain',
      body: `failed for ${EMAIL} with ${SESSION_TOKEN}`,
    })

    const failed = await failedStep(() => postCredentials(base, '/auth/sign-in/email', credentials))

    expect(failed).toContain('500')
    expect(failed).not.toMatch(MARKED)

    stand.routes.set('/auth/sign-in/email', json(403, { code: 'EMAIL_NOT_VERIFIED' }))

    expect(
      await failedStep(() => postCredentials(base, '/auth/sign-in/email', credentials)),
    ).toContain('403 EMAIL_NOT_VERIFIED')
  })
})
