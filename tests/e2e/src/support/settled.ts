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
let served: Promise<Manifest> | undefined

async function fetchManifest(context: BrowserContext): Promise<Manifest> {
  const response = await context.request.get(MANIFEST)

  if (!response.ok()) {
    throw new Error(`${MANIFEST} answered ${response.status()}`)
  }

  return manifestSchema.parse(await response.json())
}

/** The manifest, its first read shared by the reports that wait for it; a failed read is retried. */
function manifestOf(context: BrowserContext): Promise<Manifest> {
  served ??= fetchManifest(context).catch((error: unknown) => {
    served = undefined

    throw error
  })

  return served
}

/** A check that could not run, as the problem the test fails with. */
const unchecked = (error: unknown): readonly string[] => [
  `a settled state could not be checked: ${error instanceof Error ? error.message : String(error)}`,
]

/** The states a browser context's pages settled in while a test ran, held to the contract. */
export interface SettledWatch {
  /**
   * The problems of every state reported so far, each once: it awaits the checks still running,
   * and those of the reports that came while it waited, until none is left.
   */
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

  // A report that does not parse, or a manifest that cannot be read, fails the test at its end
  // as a problem would, never the page, and never while the test runs on.
  const check = async (reported: unknown): Promise<readonly string[]> =>
    settledProblems(await manifestOf(context), settledSchema.parse(reported))

  await context.exposeBinding(SETTLED_STATE, (_source, reported: unknown) => {
    checks.push(check(reported).catch(unchecked))
  })

  return {
    problems: async () => {
      const found: string[] = []

      for (let done = 0; done < checks.length; ) {
        const waiting = checks.slice(done)

        done = checks.length
        found.push(...(await Promise.all(waiting)).flat())
      }

      return [...new Set(found)]
    },
  }
}
