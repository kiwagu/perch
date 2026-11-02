import type { PeerID } from 'loro-crdt'

/**
 * The Loro peer the server writes a region's records as, the same in every region: the
 * largest one Loro allows (the very largest is its own). A device writes as a random peer of
 * its own, and the log refuses a device's batch that brings changes of this one, so no device
 * can make its changes pass as the server's. It is bound to no identity. Two concurrent
 * writes of one field with the same Lamport time go to the larger peer, so in such a tie the
 * server's value wins.
 */
export const SERVER_PEER: PeerID = '18446744073709551614'
