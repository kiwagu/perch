import type { ChangeOrigin, LocalDb, TableChange } from './types'

export const CHANGE_EVENT = 'change'

/** Tells every watcher that rows of these tables changed. */
export function publishChange(
  local: LocalDb,
  tables: readonly string[],
  origin: ChangeOrigin,
): void {
  local.changes.dispatchEvent(
    new CustomEvent<TableChange>(CHANGE_EVENT, { detail: { tables, origin } }),
  )
}

/** Subscribes to table changes; returns the unsubscribe function. */
export function onChange(local: LocalDb, listener: (change: TableChange) => void): () => void {
  const handler = (event: Event): void => listener((event as CustomEvent<TableChange>).detail)

  local.changes.addEventListener(CHANGE_EVENT, handler)

  return () => local.changes.removeEventListener(CHANGE_EVENT, handler)
}
