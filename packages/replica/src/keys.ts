/** Records of a region live in the `records` map under `<table>/<key>`. */
export function recordKey(table: string, key: string): string {
  return `${table}/${key}`
}

export function splitRecordKey(
  recordKeyValue: string,
): { readonly table: string; readonly key: string } | undefined {
  const slash = recordKeyValue.indexOf('/')

  if (slash <= 0) {
    return undefined
  }

  return { table: recordKeyValue.slice(0, slash), key: recordKeyValue.slice(slash + 1) }
}
