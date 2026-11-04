/** The `-- @name value` lines above each field, keyed `<table>.<field>`, as the schema text reader collects them. */
export type FieldAnnotations = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>

/**
 * The fields of `table` annotated `-- @readonly`, in the order the structure lists them: a
 * device sets such a field when it creates the record and never changes it after, so the
 * replica schema marks it and the gateway refuses a batch that changes it. The annotation takes
 * no value, belongs to a replicated table and marks a top-level field (the table model nests a
 * dotted field and drops a wildcard one, so the replica schema could not carry the mark);
 * anything else is reported as a problem and the field is not marked.
 */
export function annotatedReadonlyFields(
  table: string,
  rawFields: ReadonlyArray<{ readonly name: string }>,
  annotations: FieldAnnotations,
  replicated: boolean,
  problems: string[],
): readonly string[] {
  const marked: string[] = []

  for (const field of rawFields) {
    const values = annotations.get(`${table}.${field.name}`)?.get('readonly')

    if (values === undefined) {
      continue
    }

    const value = values.find((candidate) => candidate !== '')

    if (!replicated) {
      problems.push(
        `table ${table}: field ${field.name}: -- @readonly needs a replicated table (-- @region)`,
      )
    } else if (field.name.includes('.') || field.name.includes('*')) {
      problems.push(
        `table ${table}: field ${field.name}: -- @readonly marks a top-level field only`,
      )
    } else if (value !== undefined) {
      problems.push(
        `table ${table}: field ${field.name}: -- @readonly takes no value, got "${value}"`,
      )
    } else {
      marked.push(field.name)
    }
  }

  return marked
}
