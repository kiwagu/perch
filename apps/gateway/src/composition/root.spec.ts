import { describe, expect, it } from 'vitest'

import { nodeEngines } from '@workspace/data/engines/node'
import { manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import { createGatewayRoot } from './root'

describe('createGatewayRoot', () => {
  it('opens the directory database and serves sign-in over it', async () => {
    const root = (
      await createGatewayRoot({
        engines: nodeEngines(),
        url: 'mem://',
        rpcUrl: 'http://127.0.0.1:8000/rpc',
        clock: manualClock(),
      })
    )._unsafeUnwrap()

    try {
      const up = await root.sessions.signUp({ email: 'ann@example.test', password: 'pass-word-1' })

      expect(root.local.db.namespace).toBe(NAMESPACE)
      expect(root.local.db.database).toBe(DIRECTORY)
      expect(up._unsafeUnwrap().identity.id).toMatch(/^idn_/)
      expect(root.hub.loadedRegions()).toBe(0)
    } finally {
      await root.close()
    }
  })
})
