/**
 * An invariant's numbers as a reader reads them: its rule writes each value it declares as
 * `{name}`, so a number is stated once, under `values`, and a changed value changes the rule every
 * reader reads. A count is written as digits, a duration with its unit (`15 minutes`, `1 hour`).
 */

import type { InvariantValue, PlatformInvariant } from '../schemas'

/** A placeholder of a rule: anything between braces, the name it holds captured. */
export const PLACEHOLDER = /\{([^{}]*)\}/g

/** The unit of a duration as a reader writes it, one and several. */
const UNITS = {
  seconds: ['second', 'seconds'],
  minutes: ['minute', 'minutes'],
  hours: ['hour', 'hours'],
} as const

/** A value as the rule reads it: a count as digits, a duration with its unit. */
export function renderedValue(value: InvariantValue): string {
  if (typeof value === 'number') {
    return String(value)
  }

  const [unit, amount] = Object.entries(value)[0] as [keyof typeof UNITS, number]

  return `${amount} ${UNITS[unit][amount === 1 ? 0 : 1]}`
}

/**
 * The rule of `invariant` with each value it declares written in where the rule names it; a
 * placeholder naming no value stays as written (the contract check refuses it).
 */
export function renderedRule({ rule, values }: PlatformInvariant): string {
  return values === undefined
    ? rule
    : rule.replace(PLACEHOLDER, (whole, name: string) => {
        const value = Object.hasOwn(values, name) ? values[name] : undefined

        return value === undefined ? whole : renderedValue(value)
      })
}
