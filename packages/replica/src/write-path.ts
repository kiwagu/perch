import { LoroMap } from 'loro-crdt'
import { err, ok, type Result, ResultAsync } from 'neverthrow'
import { match } from 'ts-pattern'

import {
  type Command,
  type CommandMeta,
  type DataError,
  dataError,
  recordTableOf,
  type WritePathPort,
} from '@workspace/data'
import { type ChangeSpec, resolveValue, type ValueRef } from '@workspace/kernel'

import { recordKey, splitRecordKey } from './keys'
import type { RegionDoc } from './region-doc'
import { fieldOf, type ReplicaSchema } from './schema'

export interface LoroWritePathOptions {
  readonly now?: () => Date
}

const reject = (message: string): DataError => dataError('data:WRITE_REJECTED', message)

/**
 * Executes compiled commands as operations on a region document, all in one
 * commit. The commit origin routes local events (`cmd:<command id>`); the commit
 * message records who wrote and why, because only the message is persisted.
 */
export class LoroWritePath implements WritePathPort {
  readonly #now: () => Date

  constructor(
    private readonly region: RegionDoc,
    private readonly schema: ReplicaSchema,
    options: LoroWritePathOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date())
  }

  run<Params>(
    command: Command<Params>,
    params: Params,
    meta: CommandMeta = {},
  ): ResultAsync<void, DataError> {
    // A command succeeds only once its update is durable: the local database, not
    // the in-memory document, is what survives a reload.
    return ResultAsync.fromSafePromise(Promise.resolve())
      .andThen(() =>
        this.#apply(command, (params ?? {}) as Readonly<Record<string, unknown>>, meta),
      )
      .andThen(() => this.region.flush())
  }

  #apply(
    command: Command<unknown>,
    params: Readonly<Record<string, unknown>>,
    meta: CommandMeta,
  ): Result<void, DataError> {
    if (command.region !== this.region.kind) {
      return err(
        reject(`${command.id} writes the ${command.region} region, not ${this.region.kind}`),
      )
    }

    const keys = new Map<string, string>()

    for (const op of command.ops) {
      const resolved = this.#keyOf(command, op.record, params)

      if (resolved.isErr()) {
        return err(resolved.error)
      }

      keys.set(op.record, resolved.value)
    }

    const checked = this.#checkPlan(command, keys)

    if (checked.isErr()) {
      return checked
    }

    for (const op of command.ops) {
      this.#applyOp(op, keys.get(op.record) ?? '', params)
    }

    this.region.doc.commit({
      origin: `cmd:${command.id}`,
      message: JSON.stringify({
        actor: meta.actorId,
        command: command.id,
        correlationId: meta.correlationId,
      }),
    })

    return ok(undefined)
  }

  #keyOf(
    command: Command<unknown>,
    param: string,
    params: Readonly<Record<string, unknown>>,
  ): Result<string, DataError> {
    const decl = command.params.find((candidate) => candidate.name === param)
    const table = decl ? recordTableOf(decl.type) : undefined
    const value = params[param]

    if (!table) {
      return err(reject(`${command.id}: $${param} is not declared as a record parameter`))
    }

    if (typeof value !== 'string' || value === '') {
      return err(reject(`${command.id}: $${param} must be a record id`))
    }

    return ok(recordKey(table, value))
  }

  /** Validates the whole plan before touching the document, so a refused command writes nothing. */
  #checkPlan(
    command: Command<unknown>,
    keys: ReadonlyMap<string, string>,
  ): Result<void, DataError> {
    const exists = new Set(
      [...keys.values()].filter((key) => this.region.records().get(key) !== undefined),
    )

    for (const op of command.ops) {
      const key = keys.get(op.record) ?? ''

      if (op.op === 'create') {
        exists.add(key)
      } else if (op.op === 'delete') {
        exists.delete(key)
      } else if (!exists.has(key)) {
        return err(reject(`${command.id}: ${key} does not exist`))
      }

      if (op.op === 'set') {
        const table = splitRecordKey(key)?.table ?? ''
        const kind = fieldOf(this.schema, table, op.field)?.kind

        if (kind === 'list' || kind === 'counter') {
          return err(
            reject(
              `${command.id}: ${op.field} is a ${kind}; replace it with list or counter operations`,
            ),
          )
        }
      }
    }

    return ok(undefined)
  }

  #applyOp(op: ChangeSpec, key: string, params: Readonly<Record<string, unknown>>): void {
    const records = this.region.records()

    match(op)
      .with({ op: 'create' }, ({ fields }) => {
        const record = records.setContainer(key, new LoroMap())

        for (const [field, ref] of Object.entries(fields)) {
          this.#write(record, key, field, ref, params)
        }
      })
      .with({ op: 'set' }, ({ field, value }) =>
        this.#write(this.#record(key), key, field, value, params),
      )
      .with({ op: 'unset' }, ({ field }) => this.#record(key).delete(field))
      .with({ op: 'text.update' }, ({ field, value }) =>
        this.#record(key)
          .ensureMergeableText(field)
          .update(String(this.#value(value, params) ?? '')),
      )
      .with({ op: 'list.push' }, ({ field, value }) =>
        this.#record(key)
          .ensureMergeableMovableList(field)
          .push(this.#encode(key, field, this.#value(value, params))),
      )
      .with({ op: 'list.remove' }, ({ field, value }) => {
        const list = this.#record(key).ensureMergeableMovableList(field)
        const target = JSON.stringify(this.#encode(key, field, this.#value(value, params)))
        const index = (list.toJSON() as unknown[]).findIndex(
          (item) => JSON.stringify(item) === target,
        )

        if (index >= 0) {
          list.delete(index, 1)
        }
      })
      .with({ op: 'delete' }, () => records.delete(key))
      .exhaustive()
  }

  #record(key: string): LoroMap {
    return this.region.records().get(key) as LoroMap
  }

  #value(ref: ValueRef, params: Readonly<Record<string, unknown>>): unknown {
    return resolveValue(ref, params, this.#now)
  }

  #write(
    record: LoroMap,
    key: string,
    field: string,
    ref: ValueRef,
    params: Readonly<Record<string, unknown>>,
  ): void {
    const value = this.#value(ref, params)
    const table = splitRecordKey(key)?.table ?? ''

    if (fieldOf(this.schema, table, field)?.kind === 'text') {
      record.ensureMergeableText(field).update(String(value ?? ''))

      return
    }

    if (value === undefined) {
      record.delete(field)

      return
    }

    record.set(field, this.#encode(key, field, value) as never)
  }

  /** Values as the document stores them: references as `table:key`, times as ISO strings. */
  #encode(key: string, field: string, value: unknown): unknown {
    const table = splitRecordKey(key)?.table ?? ''
    const kind = fieldOf(this.schema, table, field)

    if (kind?.kind === 'record' && typeof value === 'string' && !value.includes(':')) {
      return `${kind.table}:${value}`
    }

    return value instanceof Date ? value.toISOString() : value
  }
}
