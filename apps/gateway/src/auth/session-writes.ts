import { AsyncLocalStorage } from 'node:async_hooks'

/** The tokens of the sessions Better Auth wrote while answering the call the gateway watches. */
const written = new AsyncLocalStorage<string[]>()

/**
 * Notes that Better Auth wrote the session holding `token` (`sessionHooks`, once its row exists),
 * for the call of the gateway's under way, if one is watched (`watchingSessionWrites`); nothing
 * otherwise.
 */
export function noteSessionWritten(token: string): void {
  written.getStore()?.push(token)
}

/**
 * `call`'s answer, and the tokens of the sessions Better Auth wrote while answering it, each call
 * watched on its own however many run at once: a call that failed after it wrote one leaves a
 * session nobody was handed, which its caller ends.
 */
export async function watchingSessionWrites<T>(
  call: () => Promise<T>,
): Promise<{ readonly answer: T; readonly written: readonly string[] }> {
  const tokens: string[] = []
  const answer = await written.run(tokens, call)

  return { answer, written: tokens }
}
