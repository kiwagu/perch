/**
 * What the stand's build says about its own service worker: the scripts the worker precaches,
 * read from the worker's script the front serves (`/sw.js`), which Workbox generates with the
 * build's file list in it.
 */

import type { Page } from '@playwright/test'

/** The path the front serves the worker's script at. */
const WORKER = '/sw.js'

/** Every address the worker's precache lists, as the generated script writes them. */
const ENTRY = /["']?url["']?\s*:\s*["']([^"']+)["']/g

/**
 * The path of the one precached script whose name `chunk` matches (`/assets/<name>-<hash>.js`),
 * read from the worker's script as the stand serves it: the test finds a chunk by what the build
 * made of it, so a chunk the precache lacks, or lists twice, fails here and never goes unseen.
 * The read is the page's own request context's, so it is no request of the page.
 */
export async function precachedScript(page: Page, chunk: RegExp): Promise<string> {
  const response = await page.request.get(WORKER)

  if (!response.ok()) {
    throw new Error(`${WORKER} answered ${response.status()}`)
  }

  const listed = [...(await response.text()).matchAll(ENTRY)].map((match) =>
    match[1]?.startsWith('/') ? match[1] : `/${match[1]}`,
  )
  const matching = listed.filter((path) => chunk.test(path))

  if (matching.length !== 1 || matching[0] === undefined) {
    throw new Error(`the worker's precache lists ${matching.length} scripts matching ${chunk}`)
  }

  return matching[0]
}
