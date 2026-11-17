/**
 * The anchor of an entry of the reference, which other docs link to as
 * `contract/REFERENCE.md#<slug>`: its parts in lower case, joined by `-`, every run of characters
 * outside `[a-z0-9]` written as one `-`, and none at either end. A key is
 * `referenceSlug(<file>, ...<path>)`, a map's value written `<name>` in the path
 * (`screen-anchors-name-secret`); a rule is `referenceSlug('rule', <id>)`.
 */
export function referenceSlug(...parts: readonly string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
