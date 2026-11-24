import { LoroDoc, LoroMap } from 'loro-crdt'

import { OWNER_ABILITY } from '@workspace/kernel'

import type { ReplicaSchema } from '../../schema'
import type { ValidateBatchInput } from '../batch-validator'

/** The identity id of the owner of the private region these fixtures build. */
export const actor = 'idn_a'

/** The record id of that identity, as the owner's records reference it. */
export const owner = `identity:${actor}`

const schema: ReplicaSchema = {
  profile: {
    region: 'private',
    fields: {
      identity: { kind: 'record', table: 'identity', readonly: true },
      email: { kind: 'plain', readonly: true },
      bio: { kind: 'text' },
      created_at: { kind: 'datetime', readonly: true },
    },
  },
}

/** A Loro document with the shortcuts a region document offers to the records it holds. */
class RecordsDoc extends LoroDoc {
  records(): LoroMap {
    return this.getMap('records')
  }

  recordMap(key: string): LoroMap {
    return this.records().get(key) as LoroMap
  }
}

/** The server's document of the owner's private region, holding the owner's profile `prf_1`. */
export function documentWithProfile(name: string): RecordsDoc {
  const doc = new RecordsDoc()
  const profile = doc.records().setContainer('profile/prf_1', new LoroMap())

  profile.set('identity', owner)
  profile.set('name', name)
  profile.set('created_at', '2026-10-16T09:00:00.000Z')
  profile.ensureMergeableText('bio').insert(0, 'Hello')
  doc.commit()

  return doc
}

/** A device's copy of the document, editing under a peer id of its own. */
export function forkOf(doc: LoroDoc): RecordsDoc {
  const fork = new RecordsDoc()

  fork.import(doc.export({ mode: 'snapshot' }))

  return fork
}

/** Commits the device's edits and exports the changes the server does not have yet. */
export function exportSince(client: LoroDoc, server: LoroDoc): Uint8Array {
  client.commit()

  return client.export({ mode: 'update', from: server.version() })
}

/** A batch the owner pushes to their private region. */
export function input(doc: LoroDoc, updates: readonly Uint8Array[]): ValidateBatchInput {
  return {
    doc,
    region: { kind: 'private', id: owner },
    actor,
    ability: OWNER_ABILITY,
    schema,
    updates,
  }
}
