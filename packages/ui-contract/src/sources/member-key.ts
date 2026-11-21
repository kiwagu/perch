/**
 * What a member of an object type the file writes says of a key: whether a value of the type may
 * carry it, for `declared-type.ts`. A member of that name does (but a property typed `never`,
 * `type?: never`, which no value holds, shows nothing either way), so does one whose key the file
 * cannot read (a computed name) and an index signature of strings, of symbols or of a template; one
 * of numbers (`[slot: number]`, `0: string`) says nothing of a name.
 */

import type { TSSignature } from 'oxc-parser'

import { keyName } from './values'

/** Whether `member` may be `key`, or an index that includes it: false for a call or a construct. */
export function mayBeKey(member: TSSignature, key: string): boolean {
  if (member.type === 'TSIndexSignature') {
    return member.parameters.some(
      (name) => name.typeAnnotation.typeAnnotation.type !== 'TSNumberKeyword',
    )
  }

  if (member.type !== 'TSPropertySignature' && member.type !== 'TSMethodSignature') {
    return false
  }

  const named = keyName(member.key, member.computed)
  const never =
    member.type === 'TSPropertySignature' &&
    member.typeAnnotation?.typeAnnotation.type === 'TSNeverKeyword'

  return named === undefined
    ? !(member.key.type === 'Literal' && typeof member.key.value === 'number')
    : named === key && !never
}
