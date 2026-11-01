import { surrealAdapter } from '@surrealdb/better-auth'

import type { LocalDb } from './types'

/**
 * Better Auth's database on an open SurrealDB connection, through SurrealDB's own adapter. Its
 * published build bundles a copy of the SurrealDB SDK whose `RecordId` and `DateTime` are not the
 * connection's classes, so ids were sent as empty objects and came back as objects, not strings;
 * the repository patches it (`patches/`) to use the classes of its `surrealdb` dependency. The
 * patch also binds each transaction to an adapter of its own: the published adapter shared one
 * transaction handle across concurrent requests, so they ran inside each other's transactions. A
 * subpath of its own, since the adapter loads Node modules and the browser imports the root.
 */
export function surrealAuthAdapter(local: LocalDb): ReturnType<typeof surrealAdapter> {
  return surrealAdapter({ db: local.db })
}
