/**
 * Version 3 to 4: what the engine derives from version 4, a screen file no longer writes. Each
 * part drops what the loader derives (and refuses to read written) from the screen files: what
 * an element's kind implies, the roles of a link its route gives it, the search parameter of a
 * mail's link; and writes a password pair as the one `confirms` it derives its guards from. What
 * a part cannot decide mechanically it leaves as written and names, with its file.
 */

import type { Migration } from '../migration'

import { dropKindParts } from './kind-parts'
import { dropLinkRoles } from './link-roles'
import { dropMailLinkSearch } from './mail-links'
import { writePasswordPairs } from './password-pair'

/** The one change of version 4 no part can find: nothing in a file says a parameter is the key. */
const KEY_BY_HAND =
  "write `x-perch.key: <code>` on a search parameter that is the screen's key, where no `mail.link` derives it"

export const threeToFour: Migration = {
  from: 3,
  note: "the engine derives what an element's kind implies, the roles of a link, a password pair's guards and a mail link's search parameter: the files drop them",
  run: ({ platform, screens }) => {
    const manual = [
      ...dropKindParts(screens),
      ...writePasswordPairs(screens),
      ...dropMailLinkSearch(platform, screens),
    ]

    dropLinkRoles(screens)

    return [...manual, KEY_BY_HAND]
  },
}
