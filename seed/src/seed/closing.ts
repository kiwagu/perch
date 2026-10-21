import { ResultAsync } from 'neverthrow'

/** Runs the work, then closes what it ran on whatever the outcome. */
export function closing<T, E>(
  opened: { close(): Promise<void> },
  work: ResultAsync<T, E>,
): ResultAsync<T, E> {
  const settled = async () => {
    const result = await work

    await opened.close()

    return result
  }

  return new ResultAsync(settled())
}
