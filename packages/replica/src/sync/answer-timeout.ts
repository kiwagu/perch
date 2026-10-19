/**
 * How long a push, a pull or a probe waits for its answer before it is given up for now, and
 * the connection with it: a connection that stopped answering is closed and made again.
 */
export const ANSWER_TIMEOUT_MS = 30_000

/** Cancels nothing: what a request holds while no answer timeout is scheduled for it. */
export const NO_TIMEOUT = (): void => {}
