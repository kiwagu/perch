/** `camelCase` as `kebab-case`: `currentPassword` gives `current-password`. */
export const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (upper, at: number) => `${at === 0 ? '' : '-'}${upper.toLowerCase()}`)
