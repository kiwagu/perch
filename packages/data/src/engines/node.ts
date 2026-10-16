import { createNodeEngines } from '@surrealdb/node'
import type { Engines } from 'surrealdb'

/** Embedded engines for Bun and Node: `mem://`, `surrealkv://` and `rocksdb://`. */
export const nodeEngines = (): Engines => createNodeEngines()
