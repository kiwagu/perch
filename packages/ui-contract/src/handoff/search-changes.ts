/**
 * The search parameters of the routes, for the hand-over: per route, by its path, each parameter
 * one contract adds or removes against another, as `<path> search <name>: <keywords>` (the
 * keywords it writes, each with its JSON, `wordOf`), and, for each parameter both hold, each
 * keyword whose value changes, compared as data (`keywordChanges`), as
 * `<path> search <name> <keyword> <before> -> <after>`. The keywords are the bounds of a value
 * (`VALUE_KEYWORDS`), its `default`, `required` (`true` for a parameter the route needs), `key`
 * (the failure code of a parameter that is the screen's key), the `control` that sets the
 * parameter and the `values`, per enum value, the control that chooses it (`x-perch`, the note
 * of a value aside). The description is a description change of its own. The routes are those of
 * the loaded contract, so a parameter the loader derives (a mail link's token with its key) is
 * listed as one a file writes.
 */

import type { Contract } from '../check'
import type { Binding } from '../files'

import { byName, type Change, changeOf } from './change'
import { keywordChanges, keywordWords, VALUE_KEYWORDS } from './value-words'

/** The parameters added and removed by route and name, and the keywords changed of each one both hold. */
export type SearchChanges = Change & { changed: string[] }

const SEARCH_KEYWORDS = [
  ...VALUE_KEYWORDS,
  'default',
  'required',
  'key',
  'control',
  'values',
] as const

type SearchKeyword = (typeof SEARCH_KEYWORDS)[number]

type Search = NonNullable<Binding['search']>

/** What a parameter says of itself, by keyword: the keywords it does not say are left out. */
type Keywords = Readonly<Partial<Record<SearchKeyword, unknown>>>

/** The keywords of the parameter `name` of `search`. */
function keywordsOf(
  search: Search,
  name: string,
  parameter: Search['properties'][string],
): Keywords {
  const controls = parameter['x-perch']

  return {
    ...parameter,
    required: search.required?.includes(name) === true ? true : undefined,
    key: controls?.key,
    control: controls?.control,
    values:
      controls?.values === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(controls.values).map(([value, { control, controlValue }]) => [
              value,
              { control, controlValue },
            ]),
          ),
  }
}

/** The parameters of every route of `contract`, by `<path> search <name>`; none for a contract left undefined. */
const parametersOf = (contract: Contract | undefined): Map<string, Keywords> =>
  new Map(
    (contract?.screens.screens ?? []).flatMap(({ bindings }) =>
      bindings.flatMap(({ path, search }) =>
        search === undefined
          ? []
          : Object.entries(search.properties).map(
              ([name, parameter]) =>
                [`${path} search ${name}`, keywordsOf(search, name, parameter)] as const,
            ),
      ),
    ),
  )

/** A parameter added or removed, as `<path> search <name>: <keywords>`. */
const lineOf = (name: string, keywords: Keywords | undefined): string =>
  `${name}: ${[...keywordWords(keywords ?? {}, SEARCH_KEYWORDS)].map(([keyword, word]) => `${keyword} ${word}`).join(', ')}`

export function searchChanges(
  before: Contract | undefined,
  after: Contract | undefined,
): SearchChanges {
  const was = parametersOf(before)
  const is = parametersOf(after)
  const { added, removed } = changeOf([...was.keys()], [...is.keys()])
  const changed = [...is].flatMap(([name, keywords]) => {
    const old = was.get(name)

    return old === undefined ? [] : keywordChanges(name, SEARCH_KEYWORDS, old, keywords)
  })

  return {
    added: added.map((name) => lineOf(name, is.get(name))),
    removed: removed.map((name) => lineOf(name, was.get(name))),
    changed: changed.sort(byName),
  }
}
