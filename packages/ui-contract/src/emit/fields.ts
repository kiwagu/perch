/**
 * `FIELD_FACTS`: by anchor, what the element of each field of the contract carries that the
 * contract decides, for a view to leave to its kit instead of restating it:
 *
 * - `maxLength`: the limit of a text field's value (`fieldValueOf`), unless the value is
 *   read-only;
 * - `type: 'email'`: on an input that is no secret whose value has `format: email`, a read-only
 *   one included;
 * - `marksState: false`: where the field writes it;
 * - `holdsInput: false`: on a field that holds no input, as the loader finds it or the file
 *   writes it, and on the size select a paged list derives, which holds none by its facet.
 *
 * A field none of these concerns has no entry.
 */

import { FIELD_KINDS, SIZE_SELECT, TEXT_FIELD_KINDS, testIdFor } from '../anchors'
import { type Contract, declaredAnchors } from '../check'
import { fieldValueOf } from '../files'

import { moduleText } from './module-text'

interface FieldFacts {
  readonly maxLength?: number
  readonly type?: 'email'
  readonly marksState?: false
  readonly holdsInput?: false
}

const EMAIL = 'email'

export function fieldFactsModuleOf({
  screens,
  model,
}: Pick<Contract, 'screens' | 'model'>): string {
  const anchors = declaredAnchors(screens)
  const declared = anchors.flatMap(({ anchor, def, screen }) => {
    if (!FIELD_KINDS.has(def.kind)) {
      return []
    }

    const value = TEXT_FIELD_KINDS.has(def.kind)
      ? fieldValueOf(anchor, screen, screens.platform, model)
      : undefined
    const maxLength = value?.readOnly === true ? undefined : value?.maxLength
    const email = def.kind === 'input' && def.secret !== true && value?.format === EMAIL
    const facts: FieldFacts = {
      ...(maxLength === undefined ? {} : { maxLength }),
      ...(email ? { type: EMAIL } : {}),
      ...(def.marksState === false ? { marksState: false } : {}),
      ...(def.holdsInput === false ? { holdsInput: false } : {}),
    }

    return Object.keys(facts).length === 0 ? [] : [[anchor, facts] as const]
  })
  const sizeSelects = anchors.flatMap(({ anchor, def }) =>
    def.derived?.includes(SIZE_SELECT) === true
      ? [[testIdFor(anchor, SIZE_SELECT), { holdsInput: false }] as const]
      : [],
  )

  return moduleText({
    name: 'FIELD_FACTS',
    command: 'fields',
    holds:
      'What the element of each field of the contract carries that the contract decides, by its anchor.',
    entries: [...declared, ...sizeSelects],
  })
}
