import type { TwoFactorStart } from '../../two-factor.service'

/** What the actors of the second factor answer: a start of turning it on, or the codes a renewal made. */
export type TwoFactorOutput =
  | { readonly kind: 'start'; readonly start: TwoFactorStart }
  | { readonly kind: 'codes'; readonly backupCodes: readonly string[] }

const KINDS: ReadonlySet<unknown> = new Set(['start', 'codes'])

/** Whether `output` is what an actor of the second factor answered. */
function isTwoFactorOutput(output: unknown): output is TwoFactorOutput {
  return typeof output === 'object' && output !== null && 'kind' in output && KINDS.has(output.kind)
}

/** What an actor of the second factor answered, read off the done event of its invoke; none for any other event. */
export function twoFactorOutputOf(event: object): TwoFactorOutput | undefined {
  const output: unknown = 'output' in event ? event.output : undefined

  return isTwoFactorOutput(output) ? output : undefined
}
