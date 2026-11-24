/** One index of a table: the fields it covers, in order, and whether each combination of them may occur once only. */
export interface TableIndex {
  readonly fields: readonly string[]
  readonly unique: boolean
}

/**
 * The `ASSERT` clause of each field that has one, keyed by the field's name as the structure
 * lists it (a nested field keeps its dotted name) and worded as the database prints it
 * (`IN` comes back as `INSIDE`). A field without an assert is absent.
 */
export function fieldAsserts(
  rawFields: ReadonlyArray<{ readonly name: string; readonly assert?: string }>,
): Readonly<Record<string, string>> {
  const asserts: Record<string, string> = {}

  for (const field of rawFields) {
    if (field.assert !== undefined) {
      asserts[field.name] = field.assert
    }
  }

  return asserts
}

/**
 * The indexes of a table by name. The structure words `index` as the definition's tail: empty
 * for a plain index, `UNIQUE` for a unique one, and the whole clause for a search or a vector
 * index, which is not unique.
 */
export function tableIndexes(
  rawIndexes: ReadonlyArray<{
    readonly name: string
    readonly cols: readonly string[]
    readonly index: string
  }>,
): Readonly<Record<string, TableIndex>> {
  const indexes: Record<string, TableIndex> = {}

  for (const index of rawIndexes) {
    indexes[index.name] = { fields: [...index.cols], unique: index.index === 'UNIQUE' }
  }

  return indexes
}
