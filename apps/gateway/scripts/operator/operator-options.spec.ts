import { describe, expect, it } from 'vitest'

import { readOperatorRequest } from './operator-options'

const DEV = { SURREAL_DEV_URL: 'http://127.0.0.1:8000' }

function problemOf(argv: readonly string[], env: Record<string, string | undefined> = DEV): string {
  return readOperatorRequest(argv, env)._unsafeUnwrapErr()
}

describe('readOperatorRequest', () => {
  it("names the dev stand's directory as the seed's sweep does when nothing else is said", () => {
    expect(readOperatorRequest(['grant', 'ann@example.test'], DEV)._unsafeUnwrap()).toEqual({
      action: 'grant',
      email: 'ann@example.test',
      url: 'ws://127.0.0.1:8000/rpc',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
    })
  })

  it('reads revoke as well', () => {
    expect(readOperatorRequest(['revoke', 'ann@example.test'], DEV)._unsafeUnwrap()).toMatchObject({
      action: 'revoke',
      email: 'ann@example.test',
    })
  })

  it('reads the stand, the namespace, the database and the user from its options', () => {
    const request = readOperatorRequest(
      [
        '--url=https://directory.example.test:8443',
        '--namespace=prod',
        '--database=accounts',
        '--user=owner',
        '--pass=s3cret',
        'grant',
        'ann@example.test',
      ],
      DEV,
    )._unsafeUnwrap()

    expect(request).toEqual({
      action: 'grant',
      email: 'ann@example.test',
      url: 'wss://directory.example.test:8443/rpc',
      namespace: 'prod',
      database: 'accounts',
      credentials: { username: 'owner', password: 's3cret' },
    })
  })

  it('takes the options wherever they stand among the arguments', () => {
    expect(
      readOperatorRequest(['grant', 'ann@example.test', '--user=owner'], DEV)._unsafeUnwrap()
        .credentials.username,
    ).toBe('owner')
  })

  it('takes the stand from --url before SURREAL_DEV_URL', () => {
    expect(
      readOperatorRequest(
        ['--url=http://127.0.0.1:9000', 'grant', 'ann@example.test'],
        DEV,
      )._unsafeUnwrap().url,
    ).toBe('ws://127.0.0.1:9000/rpc')
  })

  it('takes the stand from SURREAL_DEV_URL alone, with no --url', () => {
    expect(
      readOperatorRequest(['grant', 'ann@example.test'], {
        SURREAL_DEV_URL: 'http://127.0.0.1:8100',
      })._unsafeUnwrap().url,
    ).toBe('ws://127.0.0.1:8100/rpc')
  })

  it('opens an http address at its ws rpc endpoint, and a ws address at its own path', () => {
    const urlOf = (url: string) =>
      readOperatorRequest([`--url=${url}`, 'grant', 'ann@example.test'], {})._unsafeUnwrap().url

    expect(urlOf('http://127.0.0.1:8010')).toBe('ws://127.0.0.1:8010/rpc')
    expect(urlOf('https://db.example.test')).toBe('wss://db.example.test/rpc')
    expect(urlOf('ws://127.0.0.1:8010/rpc')).toBe('ws://127.0.0.1:8010/rpc')
    expect(urlOf('wss://db.example.test:8443/other')).toBe('wss://db.example.test:8443/rpc')
  })

  it('exits on a stand that is neither given nor an address of a database', () => {
    expect(problemOf(['grant', 'ann@example.test'], {})).toMatch(/--url or SURREAL_DEV_URL must be/)
    expect(problemOf(['--url=', 'grant', 'ann@example.test'])).toMatch(/must be the http/)
    expect(problemOf(['--url=db.example.test', 'grant', 'ann@example.test'])).toMatch(
      /must be the http/,
    )
    expect(problemOf(['--url=ftp://db.example.test', 'grant', 'ann@example.test'])).toMatch(
      /must be the http/,
    )
    expect(problemOf(['grant', 'ann@example.test'], { SURREAL_DEV_URL: 'not an address' })).toMatch(
      /must be the http/,
    )
  })

  it('refuses an address that carries credentials, which a failure would print', () => {
    const problem = problemOf(['--url=http://owner:s3cret@db.example.test', 'grant', 'a@b.test'])

    expect(problem).toMatch(/credentials/)
    expect(problem).not.toContain('s3cret')
  })

  it('exits on no action, an unknown one, no email, an email that is not one, or more arguments', () => {
    expect(problemOf([])).toMatch(/grant or revoke/)
    expect(problemOf(['promote', 'ann@example.test'])).toMatch(/grant or revoke/)
    expect(problemOf(['grant'])).toMatch(/email/)
    expect(problemOf(['grant', 'ann'])).toMatch(/email/)
    expect(problemOf(['grant', 'ann@example.test', 'bob@example.test'])).toMatch(/one email/)
  })

  it('exits on an option it does not know, naming it without its value', () => {
    expect(problemOf(['--role=admin', 'grant', 'ann@example.test'])).toBe('unknown option --role')

    const problem = problemOf(['--password=s3cret', 'grant', 'ann@example.test'])

    expect(problem).toBe('unknown option --password')
    expect(problem).not.toContain('s3cret')
  })

  it('exits on an option with no value, an empty one, or one given twice', () => {
    expect(problemOf(['--pass', 'grant', 'ann@example.test'])).toMatch(/--pass=<value>/)
    expect(problemOf(['--user=', 'grant', 'ann@example.test'])).toMatch(/--user/)
    expect(problemOf(['--pass=', 'grant', 'ann@example.test'])).toMatch(/--pass/)
    expect(problemOf(['--namespace=', 'grant', 'ann@example.test'])).toMatch(/--namespace/)
    expect(problemOf(['--database=', 'grant', 'ann@example.test'])).toMatch(/--database/)
    expect(problemOf(['--user=a', '--user=b', 'grant', 'ann@example.test'])).toMatch(/twice/)
  })
})
