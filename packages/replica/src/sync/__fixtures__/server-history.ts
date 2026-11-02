import { LoroDoc, LoroMap } from 'loro-crdt'

import { profileKey } from './devices'

/** Server updates of the profile: a later one that needs an earlier one, and all of it. */
export function serverHistory() {
  const author = new LoroDoc()

  author.getMap('records').setContainer(profileKey, new LoroMap()).set('name', 'Ann')
  author.commit()

  const first = author.version()

  ;(author.getMap('records').get(profileKey) as LoroMap).set('name', 'Ana')
  author.commit()

  return {
    gap: new Uint8Array(author.export({ mode: 'update', from: first })),
    all: new Uint8Array(author.export({ mode: 'update' })),
  }
}
