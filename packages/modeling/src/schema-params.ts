/** One parameter as `INFO FOR DB STRUCTURE` lists it: its name and its value as an expression the database prints. */
export interface ParamInfo {
  readonly name: string
  readonly value: string
}

const DEFINE_PARAM = /^\s*DEFINE\s+PARAM\s+(?:OVERWRITE\s+|IF\s+NOT\s+EXISTS\s+)?\$(\w+)/gim

/**
 * The parameters the schema defines, by name, each with the value the database holds for it
 * (`80` comes back as the text `80`). The database also lists the parameters its data layer
 * stores for itself, which the schema text does not define, so only the names the text defines
 * are kept.
 */
export function schemaParams(
  rawParams: readonly ParamInfo[],
  schemaText: string,
): Readonly<Record<string, string>> {
  const defined = new Set([...schemaText.matchAll(DEFINE_PARAM)].map((match) => match[1]))

  return Object.fromEntries(
    rawParams.filter(({ name }) => defined.has(name)).map(({ name, value }) => [name, value]),
  )
}
