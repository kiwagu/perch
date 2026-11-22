/**
 * A rule of the engine that no key of a contract file states, one entry of the reference. A key's
 * describe text in the schemas says what the key is for and what does not go in it, and names the
 * rule that holds the rest (`See the rule <id>.`); that rule's `text` here is the rest, in full,
 * so each fact has one text: a key's own where the key says it, else its rule's.
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
