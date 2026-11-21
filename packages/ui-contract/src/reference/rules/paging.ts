/** The rule of a paged list: the action that pages, the route that carries the page, the four parts. */

import type { ReferenceRule } from '../rule'

const pagedList: ReferenceRule = {
  id: 'paged-list',
  title: 'A paged list',
  text: [
    "`paged: true` makes the list a page of the action's entries. The action says it pages and which page sizes it answers, `paged: { sizes: [ 10, 25, 50 ], default: 25 }` in `platform.yaml` (each size once, the smallest first, the default one of them): it takes the number parameters `page`, from 1, and `size`, one of the sizes, and answers the entries of that page, in the order its `result` says, with the number of entries the other parameters find in all. The page and the size are the route's search parameters `page`, an integer with a minimum of 1 and a default of 1, and `size`, an integer whose `enum` is the action's sizes and whose default is its default, which every route of the screen declares; the source takes them from there, so no `params` names them, and a screen pages one list. A new search starts at page 1: a navigate that sets a search parameter the list reads, or `size`, says `page: 1`.",
    'A paged list derives four parts, which its `derived` lists and a screen file never writes (the loader lists them in the `derived` of the list whose source says `paged: true`). Its name has at most 3 segments (`console.users.list`, never `a.b.c.list`): its size options add two (`<list>.size-select.option`), and an anchor has 5 at most, so the check refuses a longer paged list.',
    [
      '- `<list>.range`, once the read is in: the numbers of the first and the last entry of the page and the number of entries in all (`51-100 of 312`), carried as `data-from`, `data-to` and `data-total`, with `0` and `0` where the page holds no entry (`0 of 312`: a page past the last).',
      '- `<list>.previous-link`: a link to the same route, the same search and `page` one less, on every page but the first.',
      '- `<list>.next-link`: the same with `page` one more, on every page that does not hold the last entry.',
      "- `<list>.size-select`: a select of the page size, shown wherever the list is, whose options (`<list>.size-select.option`) carry the action's sizes as `data-value` (the values of the action, never rows of the vocabulary's Choice values) and are the controls of `size`, which therefore writes no `x-perch` (the check derives them and refuses one written); choosing one moves to the same route and search with that `size` and page 1, at once, so the select holds no input, which the generated field facts carry for the kit (see the rules `field-holds-input` and `emitted-modules`): the sources write no `holdsInput` beside `testIdFor(<list>, 'size-select')`.",
    ].join('\n'),
    "A part leaves out of the address a value equal to its default (page 1, the action's default size), as every link of the app does. A range or a link that does not apply is absent from the page, never disabled, so a state that lists the list in `meta.renders` does not require them; the size select it does. `pagerOf`, `searchKeysOf` and `pageSearchOf` of `@workspace/ui-contract/anchors` compute what a page shows, which search keys a list reads for and the search a part moves to, for the app and the tests alike (`PAGE` and `SIZE` name the search parameters, `PAGING_PARTS` the four parts).",
    "`contract:check` holds a paged source: its action pages, with its sizes each once, the smallest first, its default one of them, and takes the number parameters `page` and `size`, each of type `number` or `integer` as it writes it or as the value it refers to says (see the rule `declared-values`); every route of its screen declares `page` and `size` as it reads them; no source's `params` names `page` or `size`; a screen pages one list; and a paged list has at most 3 segments. A range and the previous and next links are shown where the read decides, so the e2e run's settled check does not require them to be on the page where their list is rendered; the size select shows wherever the list does (see the rule `settled-state`). `contract:diff` lists `paged` on the line of a list that reads a platform action.",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.source.paged',
    'screen.anchors.<name>.derived',
    'platform.actions.<name>.paged',
  ],
}

/** The rules of a paged list. */
export const PAGING_RULES: readonly ReferenceRule[] = [pagedList]
