/**
 * A rule of the engine that no key of a contract file states, one entry of the reference: a key's
 * canonical text is its describe text in the schemas, a rule's is its `text` here.
 */
export interface ReferenceRule {
  /** Kebab-case and unique: the rule's anchor in the reference is `rule-<id>`. */
  readonly id: string
  readonly title: string
  readonly text: string
  /**
   * The keys it concerns, each its file and its path, dotted (`screen.anchors.<name>.secret`,
   * whose slug is `referenceSlug` of it); may be empty.
   */
  readonly keys: readonly string[]
}
