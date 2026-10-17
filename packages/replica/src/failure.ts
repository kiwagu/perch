/** The text of a failure's cause, such as the message the database gave. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
