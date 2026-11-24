/**
 * Version 2 to 3: a code of a platform action concerns the parameter it is attributed to, and an
 * error derives the field it shows the code under. No file changes but the version `migrate`
 * sets: what the new rules want is the author's to write, so the step leaves it by hand.
 */

import type { Migration } from './migration'

export const twoToThree: Migration = {
  from: 2,
  note: 'a platform code concerns the parameter it is attributed to: errors derive its field, and written fields merge over the derived ones',
  run: () => [
    'declare `values` and refer every string parameter',
    'attribute every field-shaped code',
    'write `form` or a field for each code two fields share',
    'drop written `fields` the engine derives',
  ],
}
