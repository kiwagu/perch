import type { LoroDoc, VersionVector } from 'loro-crdt'

/**
 * What the document holds after `from`, or all of it as a snapshot without a version. Loro
 * types its bytes over any buffer while a message holds them in an ArrayBuffer of their own,
 * so they are copied into one.
 */
export function exportFrom(doc: LoroDoc, from: VersionVector | null): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    from ? doc.export({ mode: 'update', from }) : doc.export({ mode: 'snapshot' }),
  )
}
