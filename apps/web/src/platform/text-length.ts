/**
 * How long a text is, in characters as the gateway and the database count them: one for each code
 * point. A character outside the basic plane (most emoji) counts once, though JavaScript's
 * `length` counts it twice, as the native `maxLength` of an input does; a rule that judges a
 * text's length against a limit of the contract counts with this.
 */
export function textLength(text: string): number {
  return [...text].length
}
