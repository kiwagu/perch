/**
 * The rules of a screen's flow: the XState subset it is written in, its states, events, guards and
 * effects, the invoke of an action, the address of a state, the shorter forms a screen file may
 * write, and how the flow is held to a machine. What a state renders is in `renders.ts`, the reads
 * in `reads.ts`.
 */

import type { ReferenceRule } from '../rule'

const flowStates: ReferenceRule = {
  id: 'flow-states',
  title: 'A flow: its states and regions',
  text: [
    "A screen's `flow` is an XState v5 machine config, in the subset `createMachine` takes as written: `contract:check` runs it in `setup({ guards, actions, actors }).createMachine(flow)`, with a stub per guard, effect and invoked actor, and an app that builds its own machine for the screen holds it to the flow with the engine's comparison (`@workspace/ui-contract/machines`), as it holds its router to the bindings. The route owns the addressable state, what a link or a reload restores; the machine owns the transient one (signing in, confirming, failed). A screen's transient state comes from its flow run as its machine, never from a component's own flags.",
    [
      '- `initial` and `states`. A state has a `description`, `type: final` where the flow ends (the app has left the screen, or stops), `entry` and `exit` effects, `on` and `invoke`.',
      "- A state of the root may be a parallel state, `type: parallel`, for the independent areas of a screen (the organisation page's create form, new note, notes' items, invitation and members): its `states` are its regions, two or more, all active at once. A region has a `description`, an `initial` and its `states`, plain states that never end, carry no `meta.address` (the address is the screen's state; their `meta` holds `renders` alone) and hold no states of their own. The parallel state has a `description`, `on`, `entry`, `exit`, `meta.address` and `meta.renders`, never an `initial` or an `invoke`; its own `on` applies whichever state each region is in. Entering it starts every region at its `initial`; leaving it leaves every region.",
      "- The flow's `id` is a one-segment name the flow declares, which the app gives its machine and an id target `#<id>.<state>` names (one segment, as XState splits a target on `.`); absent, the app names the machine by the screen id.",
    ].join('\n'),
    "Nothing else of XState is in the subset: no `context`, `after`, `always`, states nested deeper than a parallel state's regions, history states, targets by `.child` or by an id from anywhere but a region's state, or actions named by a string. A state of a region is the area's own: where the app keeps one per item (each note's edit form), the region follows the item acted on last and says so. The flow's states are the machine's; the screen's `states` stay the container states.",
  ].join('\n\n'),
  keys: [
    'screen.flow',
    'screen.flow.id',
    'screen.flow.initial',
    'screen.flow.states',
    'screen.flow.states.<name>.type',
  ],
}

const flowEvents: ReferenceRule = {
  id: 'flow-events',
  title: 'Events, targets and guards',
  text: [
    "`on` maps an event to one transition, or to a list of guarded ones in XState's order, the one without a guard last. An event is the user acting on a declared anchor (a derived one through its base's `derived`; typing, for a field), a platform event of `platform.yaml` `events` (`platform.opened`), or a data event `model.<entity>.<field>`: the stored value of a field that an anchor of the screen shows changed, here or on another device (`model.profile.name`). A transition has a `target` (absent: the machine stays where it is), a `guard`, `actions` and a `description`.",
    "XState resolves a target from the parent of its state: at the root it is a state of the flow, or a state of a region as `<parallel>.<region>.<state>` (`viewing.create-form.open`: that region starts there, the others at their `initial`); in a region it is a state of that region, or a state of the root by the machine's id, `#<flow id>.<state>` (`#organisation.viewing`), which leaves the parallel state and enters that state afresh, the parallel state itself with every region at its `initial`. Within a parallel state an event belongs to one area, one region or the state's own `on`, never two; the same event may appear in several states of one region.",
    "A guard is a camelCase name that the root `meta.guards` declares with what it holds: a sentence (`holdsUnsentChanges: this device holds changes the server has not received`), or the failure codes it takes, `{ codes: [ <code>, ... ] }`, when it tells the failures of an action apart: it holds when the action failed with one of them. A guard by failure code guards only branches of an invoke's `onError` (a region written `by` its button included), and each of its codes is one the invoked action fails with, listed once; the sign-in screen may write `emailNotVerified: { codes: [ email-not-verified ] }` for the branch of `signing-in` that leads to `unverified`. A bare `show` on such a branch shows the guard's codes (see the rule `failure-show`). An activity's guards are sentences. The app implements every guard.",
    "A control whose anchor is an event of the flow (a button, a select, a switch) is enabled exactly while a state the machine is in handles that event (`snapshot.can` in XState), and disabled otherwise: the profile's Save is disabled while it saves because neither `saving-name` nor `saving-bio` handles it. The app reads it from its machine and keeps no flag of its own. A password input's `visibility-button` is never an event of a flow, so the machine does not enable it: it is always enabled.",
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.on',
    'screen.flow.states.<name>.on.<name>.target',
    'screen.flow.states.<name>.on.<name>.guard',
    'screen.flow.meta.guards',
    'screen.flow.meta.guards.<name>.codes',
  ],
}

const flowEffects: ReferenceRule = {
  id: 'flow-effects',
  title: 'The four effects of a flow',
  text: [
    "The effects, in `actions`, `entry` and `exit`, are four: `{ type: show, params: { anchor, codes } }`, the anchor shows one of the codes it carries; `{ type: clear, params: { anchor } }`, an anchor that carries codes shows none until one is shown again, and a field is emptied; `{ type: read, params: { anchor } }`, a list of the flow's own screen whose `source` is a platform action reads that action again (see the rule `read-after-an-action`); and `{ type: navigate, params: { to, search } }`, the app moves to that binding. The app implements all four.",
    "The codes come first: a `clear` of an anchor that carries codes, whatever its kind and its screen, a field included, means it shows none until one is shown again. A field that carries none (an input, a textarea, a select, a checkbox, a radio or a switch, a `secret` one included) is emptied, and only on the flow's own screen: it returns to its empty or initial value and holds no input any more, as if nothing was typed; a form empties its passwords this way once the action that takes them succeeds. A `clear` never names a `visibility-button`, nor a button, a list, a link or any other anchor unless it carries codes.",
    "Each value of a navigate's `search` is a search key of the binding it moves to, given a literal (`$id` for a minted id) or `{ anchor: <field> }`: the value a field of the flow's own screen holds when the app moves (an input, a textarea, a select, a checkbox, a radio or a switch; never a button, a list, a `visibility-button` or a `secret` field, whose value would stay in the address, the browser's history and the logs). A link that carries the email typed so far to the page that asks for a password reset: `navigate: { to: /forgot-password, search: { email: { anchor: user.sign-in.email-input } } }`.",
    "A value may also be `{ item: <item> }`: the `data-id` of the entry of that `item` or `row` whose control the user acted on, so that the selection is in the address and a reload or a copied link reaches the same entry. Only the event of a control (a button, a link, a tab or a field, never a cell or a sibling entry) in the item's part (`<part>.<name>`, like the item), rendered in each entry, carries it, so the navigate sits in the actions of that event's transition, never in an `entry`, an `exit` or the outcome of an invoke, where no entry was acted on. The item is an entry of a list, a table or a section of the flow's own screen, declared under it or beside it in its part, and declares its `dataId`; the search key it fills takes a string. A row that opens the entity it shows: `navigate: { to: /<path>, search: { id: { item: <screen>.list.<entity>-item } } }` on `<screen>.list.open-link`. A navigate that sets a search key a paged list of the screen it moves to reads says `page: 1` (see the rule `paged-list`).",
    "The scope of each effect differs. A `show` names a declared anchor, of any screen (the frame's toast and notice included), and codes that anchor carries. A `clear` names a declared anchor that carries codes, of any kind and any screen, which then shows none, or else a field of the flow's own screen, never a `visibility-button`. A `read` names a list, a section or a table of the flow's own screen whose `source` is a platform action. A `navigate` names the path of a binding of some screen and search keys of that binding, and sits on a transition, never in an `entry` or an `exit`, moving once (see the rule `leave-questions`). An address, `meta.address`, is a binding of the flow's own screen (its first one when the path is left out) with search parameters of that binding.",
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.entry',
    'screen.flow.states.<name>.entry.show',
    'screen.flow.states.<name>.entry.clear',
    'screen.flow.states.<name>.entry.read',
    'screen.flow.states.<name>.entry.navigate',
    'screen.flow.states.<name>.entry.navigate.search',
  ],
}

const flowInvoke: ReferenceRule = {
  id: 'flow-invoke',
  title: 'An invoke and a state that has an address',
  text: [
    "An `invoke` runs a model or a platform action while the machine is in its state: `src` names it as a binding does, `input` maps each parameter as a binding's `params` do: to the anchor whose value it takes, a constant `{ value: ... }`, or a search parameter of the route `{ search: <name> }`, and `onDone` and `onError` say what follows its success and its failure. Every `input` key is a parameter of the action; a parameter left out is the implementation's to compute (a minted `$id`, the `author`). An invoke may say `read: false`: its action changes nothing a list of the screen shows, so nothing reads after it (the copy of an invitation link); one branch of its `onDone` or `onError` may say `read: false` instead, where another branch reads: nothing reads after that outcome (see the rule `read-after-an-action`). An event that runs an action is a transition into such a state, named for what it does (`signing-in`, `saving-name`, `deleting`), or `running` in the region of a button.",
    'A state that a route reaches says so in `meta.address`: its `path`, a binding of the screen, and its `search`. The route owns the addressable state, what a link or a reload restores; the machine owns the transient one (signing in, confirming, failed). One transient state is exempt and no flow holds it: whether a password input shows what it holds, which the input keeps itself and its `visibility-button` toggles (see the rule `visibility-button`).',
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.invoke',
    'screen.flow.states.<name>.invoke.input',
    'screen.flow.states.<name>.invoke.read',
    'screen.flow.states.<name>.meta.address',
  ],
}

const flowShorterForms: ReferenceRule = {
  id: 'flow-shorter-forms',
  title: 'The shorter forms of a flow',
  text: [
    "A screen file may write its flow shorter, and leave out what the contract says elsewhere (see the rules of what a screen leaves out); the loader expands it into the config above before anything reads it, so the checks, the walk in XState, the manifest and an app's machine see the full config, and `bun run contract:flow <screen>` prints it. The shorter forms are four:",
    [
      '- A transition written as its target alone, as XState itself allows: `onDone: idle` is `onDone: { target: idle }`.',
      '- An effect written by its name: `show: <anchor>`, the anchor shows one of the codes it carries, in its order (in the `onError` of an invoke, one of the codes the failure of its action shows, narrowed by a guard by failure code; see the rule `failure-show`); `show: { <anchor>: [codes] }`, one of these; `clear: <anchor>`; `read: <anchor>`; `navigate: <path>` or `navigate: { to, search }`.',
      '- A region written by its pattern, a shape that two regions or more of the screens share, named by what the area does. A shape that one region has is written in full until a second one shares it. `draft`: a control that follows a stored value or holds what was typed. In `following` the control `input` shows the stored value as it changes, here or on another device; typing moves it to `edited`, which goes back to `following` when what was typed is the stored value again, by typing it back or by the data event `stored`, both under `guard`.',
      "- A region written by its button, `by: <button>`: the region of a button bound to one action (see the rule `button-region`) with what the screen decides of it, its `description`, `onDone` and `onError`, and the `toast: false` or `read: false` it says of its action, which the loader puts on the region's invoke; a branch of its `onDone` or `onError` that says `read: false` keeps it. An outcome left out is the derived one; a transition without a target goes back to `idle`.",
    ].join('\n'),
    "The states of a pattern and of a button's region are the machine's, named by the loader (`idle`, `running`, `following`, `edited`), and a scenario or a test reads them as it reads any state. What the shorter forms leave out is mechanics a tester or a user cannot tell apart; a `description` belongs to a decision (where a success leads, what a failure shows, what restarts what), not to every state. The states of a region written by its pattern or by its button list nothing in `meta.renders`.",
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.states.<name>.pattern',
    'screen.flow.states.<name>.states.<name>.by',
  ],
}

const flowRun: ReferenceRule = {
  id: 'flow-run',
  title: 'A flow run in XState, and an app held to it',
  text: [
    "`contract:check` holds the flow to the contract and runs it in XState (the engine's `machines/walk`): a pure walk with `initialTransition` and `transition` reaches every state, a parallel state's regions each on its own with the others at their `initial`, and takes every transition and every guarded branch to its target with its effects. An app that builds its own machine for a screen holds it to the flow with the engine's comparison (`@workspace/ui-contract/machines`; the web app's `apps/web/src/platform/machines.spec.ts`): the machine has the config of its flow, what each state renders included (on a branch, the flow less what it added and the machine has not built yet), an invoke's or a branch's `read: false` aside, which is a promise the checks read and nothing a machine runs. The comparison reads the contract at the branch's merge base with `main`, and at the commit the branch is at, in ahead mode (see the rule `ahead-mode`).",
    "Carry the flow into `setup({ guards, actions, actors }).createMachine(flow)` unchanged: implement every guard it names, the four effects and an actor per `invoke.src`. `projected(config)` is what the comparison reads of a machine config (initial state, states, final states, what each state renders as a set, regions, events with their targets and guards, invoke sources, the contract's effects, `read` among them; the app's own actions and an invoke's or a branch's `read: false` left out), and `beyondTheSubset(config)` what a machine does that the flow subset has no counterpart for.",
  ].join('\n\n'),
  keys: ['screen.flow'],
}

/** The rules of a screen's flow. */
export const FLOW_RULES: readonly ReferenceRule[] = [
  flowStates,
  flowEvents,
  flowEffects,
  flowInvoke,
  flowShorterForms,
  flowRun,
]
