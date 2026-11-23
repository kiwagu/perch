/**
 * The terms file and the roles' one place. A contract with `contract/domain/terms.yaml` keeps its
 * roles there, and its vocabulary lists none; one without it lists them in the vocabulary, as
 * before. In the file a name is a term or a role, never both; a synonym is a word no term or role
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

export function termsProblems(contract: Contract): Problem[] {
  const { terms, termsLines, vocabulary } = contract

  if (terms === undefined) {
    return vocabulary.writesRoles
      ? []
      : [
          {
            file: VOCABULARY_FILE,
            message: `no section "Roles" and no ${TERMS_FILE}: the roles are listed in one of them`,
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
  const named = new Map<string, Kind>()
  const problems: Problem[] = vocabulary.writesRoles
    ? [
        {
          file: VOCABULARY_FILE,
          message: `section "Roles": the roles are in ${TERMS_FILE}, so the vocabulary does not list them`,
        },
      ]
    : []

  for (const { kind, name } of entries) {
    const earlier = named.get(name)

    if (earlier === undefined) {
      named.set(name, kind)
    } else {
      problems.push(
        at([SECTION[kind], name], `"${name}" is a ${earlier} too; a name is a term or a role`),
      )
    }
  }

  const forbidden = new Map<string, string>()

  for (const { kind, name, entry } of entries) {
    const own = new Set<string>()

    for (const [index, synonym] of (entry.synonyms ?? []).entries()) {
      const path = [SECTION[kind], name, 'synonyms', index]
      const naming = named.get(synonym)
      const holder = forbidden.get(synonym)

      if (naming !== undefined) {
        problems.push(
          at(
            path,
            `"${synonym}" names the ${naming} "${synonym}", so it is no synonym of "${name}"`,
          ),
        )
      } else if (own.has(synonym)) {
        problems.push(at(path, `"${synonym}" is listed twice`))
      } else if (holder !== undefined) {
        problems.push(
          at(
            path,
            `"${synonym}" is a synonym of "${holder}" already; a synonym belongs to one term`,
          ),
        )
      } else {
        forbidden.set(synonym, name)
      }

      own.add(synonym)
    }
  }

  return Object.keys(terms.contexts).length > 0
    ? problems
    : [...problems, at(['contexts'], 'the terms belong to a context: name one')]
}
