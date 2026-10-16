/**
 * Base of every exception the code may throw. Throwing is reserved for broken
 * programming invariants; expected outcomes travel as `Result` values. The code
 * is stable and machine-readable (`<context>:<REASON>`), the message is for logs.
 */
export abstract class ExceptionBase extends Error {
  abstract readonly code: string

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}
