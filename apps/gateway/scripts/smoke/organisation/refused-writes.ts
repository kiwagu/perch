/**
 * The smoke's refused writes in an organisation region: an edit of another member's note, a
 * note in another member's name, and a note under another member's device's Loro peer, each
 * refused for what it broke; the owner's next note is still acknowledged and delivered.
 */

import { noteIdFactory } from '@workspace/ids'
import { RegionDoc } from '@workspace/replica'

import { noteCreate, noteUpdate } from '../../../src/sync/__fixtures__/note'
import { check, step, takeUpdates, unwrap } from '../steps'

import type { Member } from './member'

/** Where the refused writes run: the region, its owner (an admin), the invited member and the owner's note. */
export interface RefusedWrites {
  readonly region: string
  readonly owner: Member
  readonly guest: Member
  readonly ownerNoteId: string
}

/**
 * Has the invited member write what the region refuses, then the owner write once more. Both
 * devices' batches continue at 3; the region stands at head 4.
 */
export async function refusedWriteSteps({
  region,
  owner,
  guest,
  ownerNoteId,
}: RefusedWrites): Promise<void> {
  await step("invited device edited the owner's note: rejected as forbidden-action", async () => {
    const edited = await noteUpdate(guest.doc, { id: ownerNoteId, text: 'Not mine' })

    guest.device.push(region, 3, unwrap(edited))

    const rejected = await guest.device.next('reject')

    check(
      rejected.batch === 3 &&
        rejected.reason === 'forbidden-action' &&
        rejected.detail === `note/${ownerNoteId}:update`,
      `rejected batch ${rejected.batch} for ${rejected.reason} (${rejected.detail})`,
    )
  })

  await step("a note in the owner's name is rejected: foreign-owner", async () => {
    // From a document of its own: the guest's one holds its refused edit, which the server lacks.
    const forged = await noteCreate(RegionDoc.inMemory('tenant', region), {
      id: noteIdFactory.create(),
      author: owner.signedIn.identity.id,
      text: 'Forged',
    })

    guest.device.push(region, 4, unwrap(forged))

    const rejected = await guest.device.next('reject')

    check(
      rejected.batch === 4 && rejected.reason === 'foreign-owner',
      `rejected batch ${rejected.batch} for ${rejected.reason}`,
    )
  })

  await step("a note under the owner device's Loro peer is rejected: foreign-peer", async () => {
    // The guest's deletion is still in the owner device's inbox.
    check(
      (await takeUpdates(owner.device, owner.doc, false)) === 4,
      'owner got no update at head 4',
    )

    // A note of the guest's own, which the write rules allow, written as the owner's device.
    const borrowed = RegionDoc.inMemory('tenant', region, BigInt(owner.doc.doc.peerIdStr))

    borrowed.doc.import(owner.doc.doc.export({ mode: 'snapshot' }))

    const created = await noteCreate(borrowed, {
      id: noteIdFactory.create(),
      author: guest.signedIn.identity.id,
      text: 'Under a borrowed peer',
    })

    guest.device.push(region, 5, unwrap(created))

    const rejected = await guest.device.next('reject')

    check(
      rejected.batch === 5 && rejected.reason === 'foreign-peer',
      `rejected batch ${rejected.batch} for ${rejected.reason}`,
    )
  })

  await step(
    "the owner's next note after it: ack at head 5, the invited device received it",
    async () => {
      const noteId = noteIdFactory.create()
      const created = await noteCreate(owner.doc, {
        id: noteId,
        author: owner.signedIn.identity.id,
        text: 'Still the admin',
      })

      owner.device.push(region, 3, unwrap(created))

      const ack = await owner.device.next('ack')

      check(ack.batch === 3 && ack.head === 5, `ack of batch ${ack.batch} at head ${ack.head}`)
      check(
        (await takeUpdates(guest.device, guest.doc, false)) === 5,
        'invited device got no update at head 5',
      )
      check(
        guest.doc.recordJson(`note/${noteId}`)?.['text'] === 'Still the admin',
        "the owner's note did not reach the invited device",
      )
    },
  )
}
