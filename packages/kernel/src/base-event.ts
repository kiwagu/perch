import { err, ok, type Result } from 'neverthrow'

import type { z } from '@workspace/zod'

export interface DomainEvent<Name extends string = string, Payload = unknown> {
  readonly name: Name
  readonly payload: Payload
  readonly actorId: string
  readonly occurredAt: Date
}

export interface InvalidEventPayload {
  readonly code: 'kernel:INVALID_EVENT_PAYLOAD'
  readonly event: string
  readonly issues: readonly z.core.$ZodIssue[]
}

export interface EventMeta {
  readonly actorId: string
  readonly occurredAt?: Date
}

export interface EventDefinition<Name extends string, Schema extends z.ZodType> {
  readonly name: Name
  readonly schema: Schema
  create(
    payload: z.input<Schema>,
    meta: EventMeta,
  ): Result<DomainEvent<Name, z.output<Schema>>, InvalidEventPayload>
}

/** Declares an event: a literal name and a Zod schema that every payload must pass. */
export function defineEvent<const Name extends string, Schema extends z.ZodType>(
  name: Name,
  schema: Schema,
): EventDefinition<Name, Schema> {
  return {
    name,
    schema,
    create(payload, meta) {
      const parsed = schema.safeParse(payload)

      if (!parsed.success) {
        return err({
          code: 'kernel:INVALID_EVENT_PAYLOAD',
          event: name,
          issues: parsed.error.issues,
        })
      }

      return ok({
        name,
        payload: parsed.data,
        actorId: meta.actorId,
        occurredAt: meta.occurredAt ?? new Date(),
      })
    },
  }
}
