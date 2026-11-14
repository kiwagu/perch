import { describe, expect, it } from 'vitest'

import { parseArgs } from './args'

describe('parseArgs', () => {
  const env = { SURREAL_URL: 'http://127.0.0.1:8010' }

  it('reads the steps and the profile with their defaults', () => {
    expect(parseArgs(['--devices', '100,500', '--hold', '30'], env)).toMatchObject({
      devices: [100, 500],
      members: 20,
      writers: 0.3,
      rate: 0.1,
      hold: 30,
      gatewayPort: 5197,
      surrealUrl: 'http://127.0.0.1:8010',
      surrealContainer: 'perch-surrealdb-e2e',
      gatewayUser: 'gateway',
      stopOnDegrade: false,
      restart: true,
    })
  })

  it('refuses a missing stand address', () => {
    expect(() => parseArgs([], {})).toThrow('SURREAL_URL')
  })

  it('refuses a flag value that is not a number, naming the flag', () => {
    expect(() => parseArgs(['--hold', 'soon'], env)).toThrow('--hold')
  })

  it('refuses --surreal-container without a value, naming the flag', () => {
    expect(() => parseArgs(['--surreal-container'], env)).toThrow('--surreal-container')
  })

  it.each([
    [['--members', '0'], '--members'],
    [['--members', '2.5'], '--members'],
    [['--writers', '1.5'], '--writers'],
    [['--writers', '-0.1'], '--writers'],
    [['--rate', '0'], '--rate'],
    [['--hold', '0'], '--hold'],
    [['--gateway-port', '70000'], '--gateway-port'],
    [['--gateway-port', '80.5'], '--gateway-port'],
    [['--devices', '100,50'], '--devices'],
    [['--devices', '0,10'], '--devices'],
    [['--devices', '10,10.5'], '--devices'],
  ])('refuses %j, naming %s', (argv, flag) => {
    expect(() => parseArgs(argv, env)).toThrow(flag)
  })

  it('accepts the edges of the domains', () => {
    expect(
      parseArgs(['--writers', '0', '--devices', '1,2', '--gateway-port', '65535'], env),
    ).toMatchObject({ writers: 0, devices: [1, 2], gatewayPort: 65535 })
  })

  it('names the stand container by the slot of the stand port', () => {
    const named = (url: string) => parseArgs([], { SURREAL_URL: url }).surrealContainer

    expect(named('http://127.0.0.1:8010')).toBe('perch-surrealdb-e2e')
    expect(named('http://127.0.0.1:8110')).toBe('perch-w1-surrealdb-e2e')
    expect(named('http://127.0.0.1:8310')).toBe('perch-w3-surrealdb-e2e')
    expect(named('http://127.0.0.1:8000')).toBeUndefined()
    expect(named('http://127.0.0.1:8111')).toBeUndefined()
    expect(parseArgs(['--surreal-container', 'mine'], { SURREAL_URL: 'http://h:1' })).toMatchObject(
      {
        surrealContainer: 'mine',
      },
    )
  })

  it('leaves the restart out on --no-restart, whatever its place among the flags', () => {
    expect(parseArgs(['--no-restart'], env).restart).toBe(false)
    expect(parseArgs(['--hold', '3', '--no-restart', '--devices', '5'], env)).toMatchObject({
      restart: false,
      hold: 3,
      devices: [5],
    })
  })

  it('reads the stop flag and the report path', () => {
    expect(parseArgs(['--stop-on-degrade', '--json', 'out.json'], env)).toMatchObject({
      stopOnDegrade: true,
      json: 'out.json',
    })
  })
})
