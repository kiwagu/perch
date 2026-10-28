import type { LoroDoc } from 'loro-crdt'

/** Who writes a batch: the identity that pushed it, and the Loro peers whose changes it brings. */
export interface BatchWriter {
  /** The identity id (its key) of the device that pushed the batch. */
  readonly identity: string
  /** Every peer whose changes the batch brings and the region lacks, as Loro names it (a decimal string). */
  readonly peers: readonly string[]
}

/**
 * The writer of a checked batch: `identity`, and each peer whose counter the fork moves past the
 * region's document (the fork holds the whole batch: one that waits for history is refused before).
 * Changes the region holds already, a batch delivered again or retried, name no peer.
 */
export function batchWriter(identity: string, doc: LoroDoc, fork: LoroDoc): BatchWriter {
  const before = doc.version().toJSON()
  const peers = [...fork.version().toJSON()]
    .filter(([peer, counter]) => counter > (before.get(peer) ?? 0))
    .map(([peer]) => peer)

  return { identity, peers }
}
