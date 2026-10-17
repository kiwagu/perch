import { type Result, ResultAsync } from 'neverthrow'
import { Surreal } from 'surrealdb'

import { type DataError, dataError } from './errors'
import type { OpenLocalDbOptions } from './local-db'

/** Where to connect and as whom; an embedded database needs no credentials. */
export type OperatorOptions = Pick<OpenLocalDbOptions, 'engines' | 'url' | 'credentials'>

/**
 * Runs one SurrealQL text as a system user and disconnects: what an operator does once
 * on a stand, such as defining namespaces, databases and their users. No namespace is
 * selected and no schema is applied, so the text selects what it needs itself. It takes
 * no parameters: definitions accept only literals (a user's password included). A server
 * that does not answer fails the call at once instead of being retried.
 */
export function runAsOperator(
  options: OperatorOptions,
  statement: string,
): ResultAsync<void, DataError> {
  const db = new Surreal({ engines: options.engines })
  const ran = ResultAsync.fromPromise(
    db.connect(options.url, {
      reconnect: false,
      ...(options.credentials ? { authentication: { ...options.credentials } } : {}),
    }),
    (cause) => dataError('data:OPEN_FAILED', `could not connect to ${options.url}`, cause),
  ).andThen(() =>
    ResultAsync.fromPromise(Promise.resolve(db.query(statement)), (cause) =>
      dataError('data:QUERY_FAILED', `the operator's statement failed on ${options.url}`, cause),
    ),
  )

  // The connection closes whatever happened; a failure to close fails a run that succeeded.
  const finish = async (): Promise<Result<void, DataError>> => {
    const result = await ran
    const closed = await ResultAsync.fromPromise(db.close(), (cause) =>
      dataError('data:QUERY_FAILED', `could not close the connection to ${options.url}`, cause),
    )

    return result.andThen(() => closed).map(() => undefined)
  }

  return new ResultAsync(finish())
}
