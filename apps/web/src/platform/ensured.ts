import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

/**
 * A record created when the store holds none. A create the document refuses because the record is
 * there after all (another device's or another tab's, which reached this document after the read)
 * is done once `projected` has projected it and a second read shows it; any other failure stays the
 * caller's.
 */
export function ensured<E>(
  read: () => ResultAsync<readonly unknown[], E>,
  create: () => ResultAsync<void, E>,
  projected: () => ResultAsync<void, E>,
): ResultAsync<void, E> {
  return read().andThen((rows) =>
    rows.length > 0
      ? okAsync(undefined)
      : create().orElse((refused) =>
          projected()
            .andThen(read)
            .andThen((now) => (now.length > 0 ? okAsync(undefined) : errAsync(refused))),
        ),
  )
}
