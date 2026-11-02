import { describe, expect, it } from 'bun:test'

import { type Observed, preflight } from './preflight.ts'

/** A dev stand whose services answer, with nothing of the pm2 stand's running: a clean start. */
const ready: Observed = {
  runs: { gateway: true, web: true },
  surreal: { url: 'http://127.0.0.1:8000/health', answers: true },
  mailbox: { url: 'http://127.0.0.1:1080/healthz', answers: true },
  front: { url: 'https://localhost:5443/', answers: true },
  gatewayPort: { port: 5181, free: true },
  pm2: { gateway: false, web: false },
}

const START = 'start the dedicated services first: mcproc start services'

describe('the preflight of bun run dev', () => {
  it('passes a ready stand without a word', () => {
    expect(preflight(ready)).toEqual({ errors: [], warnings: [] })
  })

  it('stops when the dev SurrealDB does not answer', () => {
    expect(preflight({ ...ready, surreal: { ...ready.surreal, answers: false } }).errors).toEqual([
      `the dev SurrealDB does not answer at http://127.0.0.1:8000/health; ${START}`,
    ])
  })

  it('stops when the dev MailDev does not answer', () => {
    expect(preflight({ ...ready, mailbox: { ...ready.mailbox, answers: false } }).errors).toEqual([
      `the dev MailDev does not answer at http://127.0.0.1:1080/healthz; ${START}`,
    ])
  })

  it('stops when the pm2 gateway and web of the dev stand run', () => {
    expect(preflight({ ...ready, pm2: { gateway: true, web: true } }).errors).toEqual([
      'the pm2 gateway and web of mcproc start dev already run in this checkout; stop them to run the Bun dev scripts here (mcproc stop gateway && mcproc stop web), or use the pm2 stand instead of bun run dev',
    ])
  })

  it('names the one pm2 app that runs, and not the gateway port it holds', () => {
    const observed = {
      ...ready,
      pm2: { gateway: true, web: false },
      gatewayPort: { port: 5181, free: false },
    }

    expect(preflight(observed).errors).toEqual([
      'the pm2 gateway of mcproc start dev already runs in this checkout; stop it to run the Bun dev scripts here (mcproc stop gateway), or use the pm2 stand instead of bun run dev',
    ])
  })

  it('stops when another process holds the gateway port', () => {
    expect(preflight({ ...ready, gatewayPort: { port: 5181, free: false } }).errors).toEqual([
      "127.0.0.1:5181, the dev gateway's port, is held by another process, such as another bun run dev; stop it first",
    ])
  })

  it('only warns when caddy-dev does not answer', () => {
    expect(preflight({ ...ready, front: { ...ready.front, answers: false } })).toEqual({
      errors: [],
      warnings: [
        'caddy-dev does not answer at https://localhost:5443/; the gateway and the watcher run, but the app has no front until mcproc start services',
      ],
    })
  })

  it('leaves out what an excluded workspace would need', () => {
    const down = {
      ...ready,
      surreal: { ...ready.surreal, answers: false },
      mailbox: { ...ready.mailbox, answers: false },
      gatewayPort: { port: 5181, free: false },
      pm2: { gateway: true, web: true },
    }

    expect(preflight({ ...down, runs: { gateway: false, web: true } }).errors).toEqual([
      'the pm2 web of mcproc start dev already runs in this checkout; stop it to run the Bun dev scripts here (mcproc stop web), or use the pm2 stand instead of bun run dev',
    ])
    expect(preflight({ ...down, runs: { gateway: true, web: false } }).errors).toHaveLength(3)
  })
})
