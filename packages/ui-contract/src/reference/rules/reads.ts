/**
 * The rules of what a list reads and when: the source of a list, the effect `read` that re-reads
 * it after an action, the opt-outs of a read and the reads an action holds; and the key of an
 * address, the search parameter whose missing value is a failure and whose new value starts the
 * screen afresh.
 */

import type { ReferenceRule } from '../rule'

const listReads: ReferenceRule = {
  id: 'list-reads',
  title: 'When a list reads its source',
  text: [
    "A `source` says where the entries of a list, a section or a table come from, and with it when they are read; no other kind carries one. `{ platform: <action> }`: the entries are the answer of that platform action, which the anchor reads each time it starts to render after it did not: the screen opening, a state entered that renders it (`meta.renders`) after one that did not, the account's role becoming one its `roles` admit; and, while it renders, each time the organisation or account it reads for becomes another, or a search parameter its source takes does (a `{ search: <name> }` of its `params`, and `page` and `size` when it is paged). The list shows none of the entries of the earlier search once the search is another, and a read still in flight when what it reads for becomes another is dropped: its answer is shown nowhere. A state entered after another that rendered it too reads nothing, so an anchor no state lists, rendered in every state, is read only at those moments.",
    'Every other read is said by the flow, with the effect `read: <anchor>` (see the rule `read-after-an-action`): a read after an action that changed what the list shows, never prose in a description. The `changes` of an action names the sources whose answer it changes, so it tells which lists of a screen that runs it show something else once it succeeds, and the flow holds a read of each of them after that success. `{ entity: <entity>, order, direction }`: the entries are the stored entries of that entity of the model, which the anchor follows as they change, here or on another device; such a list is never read.',
    "A platform source's `params` give the action's parameters their values: each a search parameter of the route, `{ search: <name> }`, one every route of the screen declares, or a constant, `{ value: ... }`; never a field, since what a list shows is a state of the address and what is typed is not, so a search box moves the route with a navigate and the list reads the new search. A parameter left out is the implementation's to compute, as in a binding. Each param of a platform source is a parameter of its action taking a constant or a search parameter every route of the screen declares, never `page` or `size`.",
    '`searchKeysOf(source)` of `@workspace/ui-contract/anchors` computes the search parameters a source reads, which read it again when one changes: those its params take, then `page` and `size` when it pages. `contract:diff` lists a list that reads a platform action as `<anchor> reads platform.<action>`, then each param by name (`q=search:q`, `kind="all"`), then `paged` when it pages: a list moved to another search or to paging shows as its old line removed and its new one added, and a list added whole shows its line.',
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.source',
    'screen.anchors.<name>.source.platform',
    'screen.anchors.<name>.source.params',
    'screen.anchors.<name>.source.entity',
    'platform.actions.<name>.changes',
  ],
}

const readAfterAnAction: ReferenceRule = {
  id: 'read-after-an-action',
  title: 'The read after an action, and its opt-out',
  text: [
    "`{ type: read, params: { anchor } }`, written `read: <anchor>`, names a list, a section or a table the flow's own screen declares whose `source` is a platform action (see the rule `list-reads`): it reads that action again and shows its entries once the read is in, and the app may take them from the answer of the action that just ran, when that action returns them (a sign-out of another device answers with the account's devices when they could be read after it, else without them). A `read` never names an anchor of another screen, one with no `source`, nor one whose source is an entity of the model, which follows the stored data as it changes and is never read.",
    "A read after an action is written on the outcome of its invoke (`onDone`, or an `onError` after which the list may have changed); an action that changes nothing a list of the screen shows says so on its invoke, `read: false`, and an invoke that says it and reads in one of its outcomes is refused. An action after which one outcome reads and another does not says it on that branch of its `onDone` or `onError`, `read: false` beside the branch's `guard` (the role change that demotes the account itself, after which the members list goes): only a branch of an invoke's outcome may say it, never the transition of an event; a branch that says it and reads itself is refused, once per read, and so is one under an invoke that says `read: false` already. XState ignores the key in both places, the checks and `contract:diff` read it, and the machine comparison leaves it out. `contract:diff` lists an invoke's `read: false` after its input and a branch's after its guard (`viewing.member-roles.changing onDone #1 -> idle [ownDemotion] read: false`).",
    "The read after a success is mandatory where the action may change what a list shows. An invoke holds each list, section or table of its own screen whose `source` is a platform action when its `input` takes an entry of it (an `item` or a `row` it contains, as a role change takes the members list's item), when a value of its `input` equals one its source's `params` take (the removal of an account takes `{ search: id }`, which the account's section reads its action with), or when its action's `changes` names that source (`organisations.invite` changes `organisations.invitations`, which a sent-invitations list reads); a region written `by` its button is held as its invoke. Every branch of its `onDone`, a single transition being one, then reads each list it holds, `read: <list>`, or says `read: false`: the check refuses each list a branch leaves unread, at that branch, saying why the invoke holds it. A failure holds no read, so an `onError` reads where it says, and an invoke that says `read: false` holds nothing.",
    "Every action, of the platform or of the model, writes its `changes`: each name of it is a platform action, never the action itself, that a list, a section or a table of some screen takes as its `source`, written once, `[]` for none. A switch of organisation or account, the first read's, is never named, nor what another account reads for itself. `contract:diff` lists the reads each action of the model comes to change or stops changing, as `model action lines added in <entity>.<action>: changes <read>`.",
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.entry.read',
    'screen.flow.states.<name>.on.<name>.read',
    'screen.flow.states.<name>.invoke.read',
    'platform.actions.<name>.changes',
  ],
}

const addressKey: ReferenceRule = {
  id: 'address-key',
  title: 'The key of an address',
  text: "A search parameter that is the screen's key (`x-perch.key: <code>`): a missing value, or one that breaks the value its action takes, is that action's failure `<code>`, shown as the flow shows that failure, without asking the platform; another value of it starts the screen afresh: the flow at its initial state, its fields empty, its errors cleared.",
  keys: ['screen.bindings.search.properties.<name>.x-perch.key'],
}

/** The rules of the reads of a list, and the key of an address. */
export const READ_RULES: readonly ReferenceRule[] = [listReads, readAfterAnAction, addressKey]
