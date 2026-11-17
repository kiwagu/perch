/**
 * `CONTRACT_VALUES`: every value of `platform.values` by its name and every field of the model as
 * `<entity>.<field>`, as every reader of the contract takes it (`resolveValue`): its keywords,
 * each length resolved, so a value that takes the default length carries it and one that writes
 * `maxLength: null` carries none, for the layers below the contract to read their bounds from
 * instead of restating them.
 */

import type { Contract } from '../check'
import { resolveValue } from '../files'

import { moduleText } from './module-text'

export function valuesModuleOf({
  screens: { platform },
  model,
}: Pick<Contract, 'screens' | 'model'>): string {
  const names = [
    ...Object.keys(platform.values ?? {}),
    ...Object.entries(model.entities).flatMap(([entity, { fields }]) =>
      Object.keys(fields).map((field) => `${entity}.${field}`),
    ),
  ]

  return moduleText({
    name: 'CONTRACT_VALUES',
    command: 'values',
    holds:
      'Every value of the platform by its name and every field of the model as `<entity>.<field>`, as the contract resolves it.',
    // Each name is read from the records it resolves in, so each resolves.
    entries: names.flatMap((name) => {
      const value = resolveValue(name, platform, model)

      return value === undefined ? [] : [[name, value] as const]
    }),
  })
}
