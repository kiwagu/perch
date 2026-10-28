/** Loro types exported bytes over any buffer, a message holds them in an ArrayBuffer of their own. */
export function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}
