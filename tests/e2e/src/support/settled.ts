import type { BrowserContext } from '@playwright/test'

import { type Manifest, manifestSchema, settledProblems } from '@workspace/ui-contract'
import { SETTLED_STATE, type SettledState, type SettledValue } from '@workspace/ui-contract/anchors'
import { z } from '@workspace/zod'

/** Where every stand serves the manifest of the contract its app was built from. */
const MANIFEST = '/ui-manifest/manifest.json'

/** XState's state value as the app reports it: a state of the root, or one per region. */
const valueSchema: z.ZodType<SettledValue> = z.lazy(() =>
  z.union([z.string(), z.record(z.string(), valueSchema)]),
)

/** A report of the app, with what the check reads of each anchor of its page. */
const settledSchema: z.ZodType<SettledState> = z.object({
  screen: z.string(),
  value: valueSchema,
  page: z.object({
    url: z.string(),
    anchors: z.array(z.object({ anchor: z.string(), kind: z.string(), visible: z.boolean() })),
  }),
})

/** The manifest the stand serves, read once per worker: one stand serves a whole run. */
let served: Manifest | undefined

async function manifestOf(context: BrowserContext): Promise<Manifest> {
  if (served === undefined) {
    const response = await context.request.get(MANIFEST)

    served = manifestSchema.parse(await response.json())
  }

  return served
}

/** The states a browser context's pages settled in while a test ran, held to the contract. */
export interface SettledWatch {
  /** The problems of every state reported so far, each once, the checks still running awaited. */
  problems(): Promise<readonly string[]>
}

/**
 * Exposes the binding the app's e2e build reports each settled state of a screen's machine to
 * (`SETTLED_STATE`) in every page of `context`, and holds each report to the manifest the stand
 * serves (`settledProblems`): of the anchors a screen renders only where listed, one the state
 * does not render is not visible, and one it renders is on the page and visible.
 */
export async function watchSettled(context: BrowserContext): Promise<SettledWatch> {
  const checks: Promise<readonly string[]>[] = []

  // A report that does not parse fails the test at its end, as a problem would, never the page.
  const check = async (reported: unknown): Promise<readonly string[]> =>
    settledProblems(await manifestOf(context), settledSchema.parse(reported))

  await context.exposeBinding(SETTLED_STATE, (_source, reported: unknown) => {
    checks.push(check(reported))
  })

  return { problems: async () => [...new Set((await Promise.all(checks)).flat())] }
}
