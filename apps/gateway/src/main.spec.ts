import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The gateway's package: its process starts from `src/index.ts` there. */
const GATEWAY = join(import.meta.dirname, '..')

/** An environment the gateway parses, but whose database it never reaches. */
const ENV = {
  GATEWAY_PORT: '1',
  SURREAL_URL: 'ws://127.0.0.1:1/rpc',
  GATEWAY_SURREAL_USER: 'gateway',
  GATEWAY_SURREAL_PASS: 'gateway-pass',
  GATEWAY_AUTH_SECRET: 'stand-only-auth-secret-not-for-any-deployment-0123456789abcdef',
  GATEWAY_PUBLIC_URL: 'https://localhost:5443',
  GATEWAY_MAIL_FROM: 'Perch <no-reply@example.test>',
}

interface Ended {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Starts the gateway's process with `env` and waits for it to end. */
async function started(env: Readonly<Record<string, string>>): Promise<Ended> {
  const child = Bun.spawn([process.execPath, 'src/index.ts'], {
    cwd: GATEWAY,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  return { code, stdout, stderr }
}

/** The JSON lines the gateway logged at level fatal. */
function fatalsOf(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { readonly level: number })
    .filter((line) => line.level === 60)
}

describe('the gateway process', () => {
  // The mail library refuses a host the URL standard takes for an opaque one (a NUL byte, written
  // %00), and its error carries the whole URL, the server's password with it.
  it('refuses an SMTP address the mail library cannot use by its code and exit code 1, never with the address', async () => {
    const marker = `marker-${crypto.randomUUID()}`
    const { code, stdout, stderr } = await started({
      ...ENV,
      GATEWAY_SMTP_URL: `smtp://${marker}-user:${marker}-pass@bad%00.example.test:587`,
    })

    expect(code).toBe(1)
    expect(stdout).not.toContain(marker)
    expect(stderr).not.toContain(marker)
    expect(`${stdout}${stderr}`).not.toContain('bad%00')
    expect(fatalsOf(stdout)).toStrictEqual([
      expect.objectContaining({
        code: 'mail:URL_INVALID',
        msg: 'the mail server address could not be used',
      }),
    ])
  }, 30_000)
})
