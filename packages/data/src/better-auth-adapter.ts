import { surrealAdapter } from '@surrealdb/better-auth'

import type { LocalDb } from './types'

/**
 * Better Auth's database on an open SurrealDB connection, through SurrealDB's own adapter. Its
 * published build bundles a copy of the SurrealDB SDK whose `RecordId` and `DateTime` are not the
 * connection's classes, so ids were sent as empty objects and came back as objects, not strings;
 * the repository patches it (`patches/`) to use the classes of its `surrealdb` dependency. The
 * patch also binds each transaction to an adapter of its own: the published adapter shared one
 * transaction handle across concurrent requests, so they ran inside each other's transactions.
 * And it leaves a failed join's error to the caller, which the published adapter also printed
 * whole to stderr, where its message and cause could carry the query's bindings (an email). The
 * published adapter also lacks the two single-row operations Better Auth calls on a spent
 * verification row and on a backup code or a counter, so the patch adds them: `consumeOne` deletes
 * and returns one row, `incrementOne` adds to counters and sets values on one row, answering the row
 * after the change, and the predicate that picks the row also guards the change. Each is one
 * statement, so of two callers racing for a row exactly one finds it as it was. The database
 * refuses the later of two overlapping writers of a row with a conflict: a statement on the
 * connection that it refused runs again, and finds the row as the winner left it. A transaction is
 * not run again, since what its callback did outside the database cannot be taken back; the later
 * of two overlapping transactions fails with the conflict, and Better Auth itself takes the
 * consumes of one verification identifier one at a time inside the process. A subpath of its own,
 * since the adapter loads Node modules and the browser imports the root.
 */
export function surrealAuthAdapter(local: LocalDb): ReturnType<typeof surrealAdapter> {
  return surrealAdapter({ db: local.db })
}
