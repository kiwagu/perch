/**
 * The operator's connection to a stand, where seeded accounts are swept: a system user on the
 * gateway's database, reached directly. Never part of the browser bundle.
 */

import type { ResultAsync } from 'neverthrow'

import {
  type DataError,
  type LocalDb,
  openLocalDb,
  ShapeRunner,
  type ShapeRunnerPort,
} from '@workspace/data'
import { remoteEngines, wsRpcUrl } from '@workspace/data/engines/remote'
import { readSchema } from '@workspace/data/schema-files'

/** The stand behind a gateway: its address, the gateway's namespace and database, a system user. */
export interface StandOptions {
  /** The stand's address; `http(s)://` is turned into the WebSocket endpoint. */
  readonly url: string
  readonly namespace: string
  readonly database: string
  readonly credentials: { readonly username: string; readonly password: string }
  /**
   * The key the stand's gateway signs tokens with (`GATEWAY_JWT_KEY`): the directory schema is
   * applied with it, so opening the stand never gives its access method another key.
   */
  readonly signingKey: string
}

/** The operator's connection to a stand, where seeded accounts are swept. */
export interface Stand {
  readonly local: LocalDb
  readonly runner: ShapeRunnerPort
  close(): Promise<void>
}

/**
 * Connects to a stand as its operator. The directory schema is applied as the gateway applies
 * it, with the gateway's signing key, which leaves a database that already has it alone; without
 * that key, the stand would be given a new one and every device's access token refused.
 */
export function openStand(options: StandOptions): ResultAsync<Stand, DataError> {
  return openLocalDb({
    engines: remoteEngines(),
    url: wsRpcUrl(options.url),
    namespace: options.namespace,
    database: options.database,
    credentials: options.credentials,
    schema: readSchema('directory'),
    signingKey: options.signingKey,
  }).map((local) => ({ local, runner: new ShapeRunner(local), close: () => local.close() }))
}
