/// <reference types="vite/client" />

import { createWasmWorkerEngines } from '@surrealdb/wasm'
import WorkerAgent from '@surrealdb/wasm/worker?worker'
import type { Engines } from 'surrealdb'

/**
 * Browser engines (`mem://`, `indxdb://`) running in a Web Worker, so the
 * database never blocks the main thread. Only for bundles built by Vite.
 */
export const wasmEngines = (): Engines =>
  createWasmWorkerEngines({ createWorker: () => new WorkerAgent() })
