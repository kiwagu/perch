/**
 * The engines a guest's sign-in opens, loaded ahead of it once the sign-in page is up, so they
 * never compete with it: the space's code with Loro's engine, and the database engine's WASM
 * module (4.7 MB compressed) into the browser's cache, where the engine's worker finds it when
 * the account's database opens. The module is fetched at low priority. A browser asked to save
 * data loads nothing ahead: a guest may never sign in.
 */

import { wasmEngineModule } from '@workspace/data/engines/wasm-module'

/** Whether the browser asks pages to save data (`navigator.connection.saveData`, Chromium's). */
function savesData(navigator: object): boolean {
  const connection: unknown = Reflect.get(navigator, 'connection')

  return (
    typeof connection === 'object' &&
    connection !== null &&
    Reflect.get(connection, 'saveData') === true
  )
}

/** What the warm-up reads of the page: its fetch, and its navigator for the connection. */
export interface WarmPage {
  readonly fetch: Window['fetch']
  readonly navigator: object
}

/**
 * Loads the engines ahead through `load`, the space's code, and `page`'s fetch. What fails here
 * only means it loads when the space opens, which says so if it fails again.
 */
export function warmEngines(page: WarmPage, load: () => Promise<unknown>): void {
  if (savesData(page.navigator)) {
    return
  }

  void load().catch(() => undefined)
  void page
    .fetch(wasmEngineModule, { priority: 'low' })
    // Read to the end, so the whole module lands in the cache, and kept nowhere.
    .then((response) => response.blob())
    .catch(() => undefined)
}
