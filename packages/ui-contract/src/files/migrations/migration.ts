/**
 * A migration: the step that rewrites a contract from one version of the format to the next.
 * `contract:migrate` runs one per version, oldest first, and sets the platform's `version` after
 * each; a step only edits what its version changed.
 */

import type { Document } from 'yaml'

/** The files a step may rewrite, as `migrate` read them. */
export interface MigrationFiles {
  /** `contract/domain/platform.yaml`, its comments kept. */
  readonly platform: Document
  /** Every file of `contract/domain/screens/`, by its path under that folder (`sample/$key.yaml`). */
  readonly screens: ReadonlyMap<string, Document>
  /** The text of `contract/vocabulary.md`. */
  vocabulary: string
}

export interface Migration {
  /** The version the step reads; it writes the next one. */
  readonly from: number
  /** What the step changes, in one line. */
  readonly note: string
  /**
   * Edits the documents (values, keys, pairs and items; a comment changed on a node it keeps is not
   * written) and the vocabulary in place; returns what is left to do by hand.
   */
  readonly run: (files: MigrationFiles) => readonly string[]
}
