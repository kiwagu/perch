import type { AuthSessions } from '../../auth/auth-sessions'
import { type BearerCaller, bearerCaller } from '../../auth/bearer-caller'

/** An operator of the platform, as the console's routes take one. */
export type Operator = Extract<BearerCaller, { readonly kind: 'caller' }>

/** Who a console request comes from: an operator, an account that is none, or why there is none. */
export type OperatorCaller =
  | Operator
  | { readonly kind: 'not-operator' }
  | Exclude<BearerCaller, Operator>

/** Answers a request of an operator, from the client address `from`. */
export type Handler = (operator: Operator, request: Request, from: string) => Promise<Response>

/**
 * Who a console request comes from: the Bearer caller (`bearerCaller`: a valid device header, a
 * live and admitted session of that device), and then an operator, `operator` being among the
 * platform roles read with that session for this very request, never kept from an earlier one;
 * so a role taken back refuses the next request (`not-operator`). The refusals and the failure of
 * the Bearer caller pass on as they are.
 */
export async function operatorCaller(
  sessions: Pick<AuthSessions, 'read'>,
  request: Request,
): Promise<OperatorCaller> {
  const caller = await bearerCaller(sessions, request)

  return caller.kind === 'caller' && !caller.roles.includes('operator')
    ? { kind: 'not-operator' }
    : caller
}
