import { describe, expect, it } from 'vitest'

import { gatewayConfig } from './config'

const env = {
  GATEWAY_PORT: '8080',
  SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
  GATEWAY_SURREAL_USER: 'gateway',
  GATEWAY_SURREAL_PASS: 'gateway-pass',
  GATEWAY_AUTH_SECRET: 'stand-only-auth-secret-not-for-any-deployment-0123456789abcdef',
  GATEWAY_PUBLIC_URL: 'https://localhost:5443',
  GATEWAY_SMTP_URL: 'smtp://127.0.0.1:1025',
  GATEWAY_MAIL_FROM: 'Perch <no-reply@example.test>',
  PATH: '/usr/bin',
}

describe('gatewayConfig', () => {
  it('parses a valid environment', () => {
    expect(gatewayConfig.parse(env)).toEqual({
      GATEWAY_PORT: 8080,
      SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
      GATEWAY_SURREAL_USER: 'gateway',
      GATEWAY_SURREAL_PASS: 'gateway-pass',
      GATEWAY_AUTH_SECRET: env.GATEWAY_AUTH_SECRET,
      GATEWAY_PUBLIC_URL: 'https://localhost:5443',
      GATEWAY_SMTP_URL: 'smtp://127.0.0.1:1025',
      GATEWAY_MAIL_FROM: 'Perch <no-reply@example.test>',
    })
  })

  it('names the variable that does not parse', () => {
    const parsed = gatewayConfig.safeParse({ ...env, GATEWAY_PORT: 'abc' })

    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['GATEWAY_PORT'])
  })

  it('names a missing variable', () => {
    const { GATEWAY_SURREAL_PASS: _missing, ...partial } = env
    const parsed = gatewayConfig.safeParse(partial)

    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'GATEWAY_SURREAL_PASS',
    ])
  })
})

describe('gatewayConfig.SURREAL_URL', () => {
  it('accepts a WebSocket address', () => {
    const parsed = gatewayConfig.parse({ ...env, SURREAL_URL: 'wss://db.example.test/rpc' })

    expect(parsed.SURREAL_URL).toBe('wss://db.example.test/rpc')
  })

  it('refuses an address that is not WebSocket, naming the rule', () => {
    for (const url of ['http://127.0.0.1:8000/rpc', 'https://db.example.test/rpc']) {
      const parsed = gatewayConfig.safeParse({ ...env, SURREAL_URL: url })

      expect(parsed.error?.issues.map(({ path, message }) => [path.join('.'), message])).toEqual([
        [
          'SURREAL_URL',
          'must be a ws:// or wss:// address: the gateway holds one WebSocket to the directory',
        ],
      ])
    }
  })
})

describe('gatewayConfig.GATEWAY_AUTH_SECRET', () => {
  it('is required', () => {
    const { GATEWAY_AUTH_SECRET: _missing, ...partial } = env
    const parsed = gatewayConfig.safeParse(partial)

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'GATEWAY_AUTH_SECRET',
    ])
  })

  it('refuses a secret shorter than 32 characters, naming the rule and not the value', () => {
    const parsed = gatewayConfig.safeParse({ ...env, GATEWAY_AUTH_SECRET: 'short' })

    expect(parsed.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['GATEWAY_AUTH_SECRET', 'must be at least 32 characters, such as openssl rand -hex 32'],
    ])
  })
})

describe('gatewayConfig.GATEWAY_PUBLIC_URL', () => {
  it('takes the front origin and strips a trailing slash', () => {
    expect(
      gatewayConfig.parse({ ...env, GATEWAY_PUBLIC_URL: 'https://localhost:5443/' })
        .GATEWAY_PUBLIC_URL,
    ).toBe('https://localhost:5443')
  })

  it('refuses an address that is not http(s)', () => {
    expect(gatewayConfig.safeParse({ ...env, GATEWAY_PUBLIC_URL: 'ws://localhost' }).success).toBe(
      false,
    )
  })
})

describe('gatewayConfig.GATEWAY_SMTP_URL', () => {
  it('is required', () => {
    const { GATEWAY_SMTP_URL: _missing, ...partial } = env

    expect(
      gatewayConfig.safeParse(partial).error?.issues.map((issue) => issue.path.join('.')),
    ).toEqual(['GATEWAY_SMTP_URL'])
  })

  it('takes smtp:// and smtps:// with credentials, and refuses http:// without naming the value', () => {
    expect(
      gatewayConfig.safeParse({
        ...env,
        GATEWAY_SMTP_URL: 'smtps://user:secret@smtp.example.test:465',
      }).success,
    ).toBe(true)

    const refused = gatewayConfig.safeParse({
      ...env,
      GATEWAY_SMTP_URL: 'http://secret@smtp.example.test',
    })

    expect(refused.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['GATEWAY_SMTP_URL', 'must be the smtp:// or smtps:// address of the mail server'],
    ])
  })

  // The mail library reads a query parameter as an option of its transport, over the gateway's
  // own (its waits, its logger: `?logger=true` would log every address).
  it.each([
    ['a query string', 'smtp://127.0.0.1:1025?logger=true'],
    ['an empty query string', 'smtps://user:secret@smtp.example.test:465?'],
    ['a fragment', 'smtp://127.0.0.1:1025#secret'],
    ['an empty fragment', 'smtp://127.0.0.1:1025#'],
  ])('refuses an address with %s, without naming the value', (_label, url) => {
    const refused = gatewayConfig.safeParse({ ...env, GATEWAY_SMTP_URL: url })

    expect(refused.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      [
        'GATEWAY_SMTP_URL',
        'must carry no query string or fragment: the mail library reads them as its options',
      ],
    ])
  })

  // The URL standard keeps the host of an smtp:// address opaque, so a NUL byte written %00 or an
  // escaped slash passes it; the mail library reads that host the way a web address's host is
  // read and refuses it with an error that carries the whole address, the password with it.
  it.each([
    ['a NUL byte', 'smtp://user:secret@bad%00.example.test:587'],
    ['an escaped space', 'smtps://user:secret@bad%20x.example.test:465'],
    ['an escaped slash', 'smtp://bad%2F.example.test:25'],
    ['a broken escape', 'smtp://b%zzd.example.test:25'],
    ['a label that is not an international name', 'smtp://xn--a.example.test:25'],
    ['an IPv4 address out of range', 'smtp://999.1.1.1:25'],
  ])('refuses a host with %s, naming the rule and not the value', (_label, url) => {
    const refused = gatewayConfig.safeParse({ ...env, GATEWAY_SMTP_URL: url })

    expect(refused.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['GATEWAY_SMTP_URL', 'must name the mail server by a domain name or an IP address'],
    ])
    expect(JSON.stringify(refused.error?.issues)).not.toContain('secret')
  })

  it('takes a host by a domain name, an international one, or an IP address', () => {
    for (const url of [
      'smtp://mail.example.test:25',
      'smtps://user:secret@münchen.example:465',
      'smtp://127.0.0.1:1025',
      'smtp://[::1]:1025',
    ]) {
      expect(gatewayConfig.safeParse({ ...env, GATEWAY_SMTP_URL: url }).success).toBe(true)
    }
  })
})

describe('gatewayConfig.GATEWAY_MAIL_FROM', () => {
  it('takes an address with or without a name, and refuses anything else', () => {
    for (const from of ['Perch <no-reply@example.test>', 'no-reply@example.test']) {
      expect(gatewayConfig.safeParse({ ...env, GATEWAY_MAIL_FROM: from }).success).toBe(true)
    }

    for (const from of ['Perch', 'Perch <no-reply>', '']) {
      expect(gatewayConfig.safeParse({ ...env, GATEWAY_MAIL_FROM: from }).success).toBe(false)
    }
  })

  it('is required', () => {
    const { GATEWAY_MAIL_FROM: _missing, ...partial } = env

    expect(
      gatewayConfig.safeParse(partial).error?.issues.map((issue) => issue.path.join('.')),
    ).toEqual(['GATEWAY_MAIL_FROM'])
  })
})
