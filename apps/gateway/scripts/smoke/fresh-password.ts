/** A password of its own for every call, which keeps the rules of a new password. */
export function freshPassword(): string {
  // A letter of each case and a symbol before the random part, a digit after it: 26 characters.
  return `Smoke-${crypto.randomUUID().slice(0, 18)}-1`
}
