/**
 * Who does what, from where, as part of which flow. Passed explicitly to every
 * bus call instead of living in ambient storage, so the same code runs in the
 * browser and on a server.
 */
export interface ExecutionContext {
  readonly actorId: string
  readonly deviceId: string
  readonly tenantId: string | null
  readonly correlationId: string
}
