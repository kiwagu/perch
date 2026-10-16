/**
 * Names that bind a `.surql` file to its generated module. The modeling stage
 * exports `<camelName>Shape` and `<camelName>Commands` from `<name>.model.gen.ts`,
 * and the bundler plugins import exactly those names, so both use these helpers.
 */

const words = (name: string): string[] => name.split(/[^A-Za-z0-9]+/).filter(Boolean)

export const pascalCase = (name: string): string =>
  words(name)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

export const camelCase = (name: string): string => {
  const pascal = pascalCase(name)

  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export type SurqlRole = 'shape' | 'commands'

/** `profile.shape.surql` → `{ name: 'profile', role: 'shape' }`; any other file → undefined. */
export function surqlComponentFile(
  fileName: string,
): { name: string; role: SurqlRole } | undefined {
  const match = /^(.+)\.(shape|commands)\.surql$/.exec(fileName)

  return match?.[1] && match[2] ? { name: match[1], role: match[2] as SurqlRole } : undefined
}

export const surqlExportName = (name: string, role: SurqlRole): string =>
  `${camelCase(name)}${role === 'shape' ? 'Shape' : 'Commands'}`
