/**
 * Version 3 to 4: what an element's kind implies and the roles a route gives a link are derived,
 * and a screen file never writes them. No file changes but the version `migrate` sets: the step
 * leaves what the new rules refuse to the author, for now.
 */

import type { Migration } from './migration'

export const threeToFour: Migration = {
  from: 3,
  note: "what an element's kind implies and the roles of a link's route are derived, and a file never writes them",
  run: () => [
    "drop a select's `dataValue` and `option`, a secret input's `visibility-button`, and the `confirm-button` and `cancel-button` of a dialog or a confirmation",
    "drop the `roles` of a link that admit what its route's roles admit",
  ],
}
