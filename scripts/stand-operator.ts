#!/usr/bin/env bun
/**
 * The stand operator: sets up what the gateway needs on a local SurrealDB stand, connected
 * as the stand's root user (`stand-operator.surql`: the `app` namespace, its `directory`
 * database and the gateway's namespace user). Every statement may run again, so the
 * gateway's mcproc apps run it before each start. Run it from the repository root, whose
 * bunfig registers the `.surql` loader. It prints the endpoint it set up, never a password.
 *
 *   SURREAL_URL=http://127.0.0.1:8010 SURREAL_USER=root SURREAL_PASS=root bun scripts/stand-operator.ts
 */

import { runAsOperator } from '@workspace/data'
import { remoteEngines, wsRpcUrl } from '@workspace/data/engines/remote'
import { z } from '@workspace/zod'

import operatorStatement from './stand-operator.surql'

const operatorEnv = z.object({
  /** The stand's `http(s)://` or `ws(s)://` address; the operator connects over WebSocket. */
  SURREAL_URL: z.url({
    protocol: /^(https?|wss?)$/,
    error: 'must be an http(s):// or ws(s):// address of the stand',
  }),
  /** The stand's root user. */
  SURREAL_USER: z.string().min(1),
  SURREAL_PASS: z.string().min(1),
})

async function main(env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const parsed = operatorEnv.safeParse(env)

  if (!parsed.success) {
    // An issue names the variable and the rule it breaks, never the value it holds.
    for (const issue of parsed.error.issues) {
      console.error(`stand-operator: ${issue.path.join('.')}: ${issue.message}`)
    }

    return 1
  }

  const url = wsRpcUrl(parsed.data.SURREAL_URL)
  const ran = await runAsOperator(
    {
      engines: remoteEngines(),
      url,
      credentials: { username: parsed.data.SURREAL_USER, password: parsed.data.SURREAL_PASS },
    },
    operatorStatement,
  )

  return ran.match(
    () => {
      console.log(`stand-operator: gateway user ready on ${url}`)

      return 0
    },
    ({ code, message, cause }) => {
      const reason = cause instanceof Error ? `: ${cause.message}` : ''

      console.error(`stand-operator: ${code} ${message}${reason}`)

      return 1
    },
  )
}

process.exit(await main(process.env))
