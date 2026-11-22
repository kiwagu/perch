import type { SignInOutcome } from '../sign-in.service'

/** The kinds of what a step of signing in answers. */
const KINDS: ReadonlySet<unknown> = new Set(['signed-in', 'code-required', 'device-limit'])

/** Whether `output` is what a step of signing in answered: the outcome of the service, as its actors give it. */
function isOutcome(output: unknown): output is SignInOutcome {
  return typeof output === 'object' && output !== null && 'kind' in output && KINDS.has(output.kind)
}

/** What a step of signing in answered, read off the done event of its invoke; none for any other event. */
export function outcomeOf(event: object): SignInOutcome | undefined {
  const output: unknown = 'output' in event ? event.output : undefined

  return isOutcome(output) ? output : undefined
}
