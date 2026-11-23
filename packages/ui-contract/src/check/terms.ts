/**
 * The terms file and the roles' one place. A contract writes `contract/domain/terms.yaml` and keeps
 * its roles there; its vocabulary lists none. A contract of an older ref that lists them in the
 * vocabulary still loads (a diff reads it), and the check refuses it. In the file a name is a term or a role, never both; a synonym is a word no term or role
 * is named, forbidden for one of them only, and listed once; and the terms belong to at least one
 * context.
 */

import {
  jsonPath,
  lineAt,
  type Problem,
  TERMS_FILE,
  type TermEntry,
  VOCABULARY_FILE,
} from '../files'

import type { Contract } from './contract'
import { namedBy, sameSynonym } from './synonyms'

type Kind = 'term' | 'role'

const SECTION: Readonly<Record<Kind, 'terms' | 'roles'>> = { term: 'terms', role: 'roles' }

/** The terms and the roles of the file, each with its kind and its section, in the file's order. */
function entriesOf(terms: NonNullable<Contract['terms']>) {
  return (['term', 'role'] as const).flatMap((kind) =>
    Object.entries<TermEntry>(terms[SECTION[kind]]).map(([name, entry]) => ({
      kind,
      name,
      entry,
    })),
  )
}

/**
 * Whether the contract is one written before the terms file: none, and its roles in the
 * vocabulary. It still loads (a diff reads it), and only the in-flight check lets it pass, as a
 * branch's that has not merged `main` since the file came.
 */
export const isBeforeTerms = ({ terms, vocabulary }: Contract): boolean =>
  terms === undefined && vocabulary.writesRoles

export function termsProblems(contract: Contract): Problem[] {
  const { terms, termsLines, vocabulary } = contract

  if (terms === undefined) {
    return [
      {
        file: TERMS_FILE,
        message:
          'missing: the contract writes its terms and its roles here, and the vocabulary lists no roles',
      },
    ]
  }

  const at = (path: readonly PropertyKey[], message: string): Problem => {
    const line = lineAt(termsLines, path)
    const text = `${jsonPath(path)}: ${message}`

    return line === undefined
      ? { file: TERMS_FILE, message: text }
      : { file: TERMS_FILE, line, message: text }
  }
  const entries = entriesOf(terms)
  // One name: a dash and a space between words are the same, as the check reads them.
  const words = (text: string): string => text.replaceAll('-', ' ')
  const named = new Map<string, { readonly kind: Kind; readonly name: string }>()
  const problems: Problem[] = vocabulary.writesRoles
    ? [
        {
          file: VOCABULARY_FILE,
          message: `section "Roles": the roles are in ${TERMS_FILE}, so the vocabulary does not list them`,
        },
      ]
    : []

  for (const { kind, name } of entries) {
    const earlier = named.get(words(name))?.kind

    if (earlier === undefined) {
      named.set(words(name), { kind, name })
    } else {
      problems.push(
        at([SECTION[kind], name], `"${name}" is a ${earlier} too; a name is a term or a role`),
      )
    }
  }

  const forbidden: Array<{ readonly synonym: string; readonly term: string }> = []

  for (const { kind, name, entry } of entries) {
    const own: string[] = []

    for (const [index, synonym] of (entry.synonyms ?? []).entries()) {
      const path = [SECTION[kind], name, 'synonyms', index]
      const naming = entries.find((other) => namedBy(other.name, synonym))
      const holder = forbidden.find((held) => sameSynonym(held.synonym, synonym))?.term

      if (naming !== undefined) {
        problems.push(
          at(
            path,
            `"${synonym}" names the ${naming.kind} "${naming.name}", so it is no synonym of "${name}"`,
          ),
        )
      } else if (own.some((listed) => sameSynonym(listed, synonym))) {
        problems.push(at(path, `"${synonym}" is listed twice`))
      } else if (holder !== undefined) {
        problems.push(
          at(
            path,
            `"${synonym}" is a synonym of "${holder}" already; a synonym belongs to one term`,
          ),
        )
      } else {
        forbidden.push({ synonym, term: name })
      }

      own.push(synonym)
    }
  }

  return Object.keys(terms.contexts).length > 0
    ? problems
    : [...problems, at(['contexts'], 'the terms belong to a context: name one')]
}
