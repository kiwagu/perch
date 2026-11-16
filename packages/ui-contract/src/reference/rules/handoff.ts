/**
 * The rules of the hand-over: what `contract:diff` lists of a change, the lines of a flow and of
 * a platform action, how a written description is named by its place, and what a change hands
 * over with it.
 */

import type { ReferenceRule } from '../rule'

const contractDiff: ReferenceRule = {
  id: 'contract-diff',
  title: 'What contract:diff lists of a change',
  text: [
    '`contractAt(ref, root)` reads the contract files, the screen files, the activities and the scenarios at a git ref (`git ls-tree`, `git show`) and loads them, or returns `{ missing: true }` when that commit has no `contract/`; `diffContracts(before, after)` returns the `ContractChanges`, and `bun run contract:diff <ref>` prints them as `formatChanges(changes)` does (see the rule `hand-over`). A contract left undefined is an empty one. The diff lists what both sides write or derive, so a screen written shorter that loads to the same contract shows no change but the descriptions it stops writing.',
    [
      'The lists, in the order of the block, each added and removed and sorted:',
      '',
      '- the screens, and the route access lines: who each route serves as `<path> guard <guard>` and `<path> serves <role>`, a route added whole with every line;',
      '- the search parameters of each route, written or derived (the token of a mail link, with its key): a parameter added or removed as `<path> search <name>: <keywords>`, and each keyword it changes as `<path> search <name> <keyword> <before> -> <after>` (`/verify-email search token key "link-invalid" -> "link-expired"`), each side as JSON and `none` where it lacks the keyword. The keywords are the bounds of the value, `default`, `required` (`true`), `key`, `control` and `values` (the control of each enum value); a route added or removed whole lists every parameter, and a description is a description change of its own;',
      '- the anchors, with the anchors renamed (below); the lists that read a platform action as `<anchor> reads platform.<action>`, then each param by name (`q=search:q`, `kind="all"`), then `paged` when it pages: a list moved to another search or to paging shows as its old line removed and its new one added, and a list added whole shows its line;',
      "- on the anchors both sides hold, the derived parts as `<anchor>.<suffix>` (`<input>.visibility-button` for the eye of a password input), the codes as `<anchor> <code>` and the states as `<anchor> <state>`, written or derived, so a constraint added to the model shows as the code it gives and a change of a composite's item state shows on each item it derives, the roles each is shown to as `<anchor> <role>`, an error's fields as `<error> <code> -> <field>`, the fields that hold input as `<anchor> holds input`, the fields that drop their state colour as `<anchor> shows no state colour`, the controls that ask before a destructive action as `<anchor> asks <code>`, the controls that ask before they leave their screen as `<anchor> leaves losing <field>, <field>` (other fields show as the old line removed and the new one added), and the messages that rank their codes as `<anchor> ranks <code> > <code>`, a new order as the old line removed and the new one added, which the codes compared as a set do not show;",
      '- when each anchor shows, the entries of its `with` and `without` (see the rule `with-without`) as `<anchor> with <entry>` and `<anchor> without <entry>`, the entry being the anchor it names, with `: <code> or <code>` when it names codes (as a set, sorted: `device.list.revoke-button without device.list.current-badge`, `app-shell.install-button with app-shell.install-message: install-available`), and, for an entry both sides hold, `<anchor> with <entry> codes <before> -> <after>` when its codes change, `none` on the side that names none. An anchor added or removed whole lists every entry, and an anchor renamed holds its entries, also where an entry names a renamed anchor. The entries are those of the loaded contract;',
      '- the codes of the contract, the composites by name, the entities and their fields as `<entity>.<field>`, the activities by id;',
      '- the actions of `platform.leaving` added and removed, the entries of `platform.unsavedInput` as `<leave>: <how it asks>` (and `question: <dialog>`), what `platform.defaults` declares as `<keyword> <value>` (`maxLength 80`), the values of `platform.values` added, removed and changed (see the rule `declared-values`), and the notices of the platform actions as `<action>.<name>`;',
      '- per activity both sides hold, the transitions added and removed as `<state> on <anchor> -> <target>`;',
      '- per screen both sides hold with a flow on either side, the lines of its flow (see the rule `contract-diff-lines`);',
      '- the platform actions by name, and per platform action either side holds the lines of the action (see the rule `contract-diff-lines`);',
      '- per action of the model either side holds, by `<entity>.<action>`, the reads its `changes` names, as `changes <read>`, added and removed (an action one side lacks names none), listed as `model action lines added in <entity>.<action>` (`model action lines added in profile.updateName: changes accounts.list, changes accounts.read`); an action added or removed whole shows each read it changes;',
      '- last, the descriptions changed (see the rule `description-places`).',
    ].join('\n'),
    "An anchor removed and one added are a rename wherever a screen and a kind lost exactly one anchor and gained exactly one: with more on either side the pairing would be a guess, so they stay removed and added. What the anchors both sides hold carry (derived parts, codes, states, roles, error fields, input, colour, questions, ranks, descriptions) is compared under a renamed anchor's new name.",
    '`formatChanges(changes)` prints the block a change hands over: `contract changes: none` when nothing changed, else a summary line (`contract changes: 1 anchor renamed`), then one line per list that is not empty (`anchors renamed: device.list.revoke-button -> device.list.sign-out-button`), the transitions as `transitions added in <activity>`, the lines of a flow as `flow lines added in <screen>`, those of a platform action as `platform action lines added in <action>` and those of an action of the model as `model action lines added in <entity>.<action>`, and last `descriptions changed: <place> <before> -> <after>, ...`.',
  ].join('\n\n'),
  keys: [],
}

const contractDiffLines: ReferenceRule = {
  id: 'contract-diff-lines',
  title: 'The lines of a flow and of a platform action in the diff',
  text: [
    "A screen's flow is listed as `flow lines added in <screen id>` and `flow lines removed in <screen id>`, one line per fact the flow says (`flowLines(flow)`, an internal helper of the hand-over). A state is named by its path (`viewing.form.open`) and descriptions are left out, as they change nothing that runs. A flow one side lacks has no lines, so a flow added or removed whole shows every line; a screen added or removed whole is a change of the screens alone. The lines:",
    [
      '- `initial <state>`, and `<path> initial <state>` for each region;',
      "- `guard <name> takes <code>, <code>`, one per guard by failure code, its codes as written, and `guard <name>: confirms <differs|strays|follows>` or `guard <name>: composite breaks`, one per guard a password pair derives; a guard's sentence is prose and has no line;",
      "- `<path> address <path> <search as JSON, keys sorted>`, those the state's address has;",
      '- `<path> renders <anchor>`, one per anchor of its `meta.renders` (`check-mail renders user.sign-in.resend-button`);',
      '- `<path> entry|exit <effect>`;',
      '- `<path> on <event> -> <target> [<guard>] <effects>`;',
      '- `<path> invoke <action> <input as JSON, keys sorted> [read: false]`;',
      "- `<path> onDone|onError [#<n>] -> <target> [<guard>] [read: false] <effects>`, a branch's `read: false` after its guard (`viewing.member-roles.changing onDone #1 -> idle [ownDemotion] read: false`);",
      '- `<path> final`.',
    ].join('\n'),
    'An effect is written `show <anchor>: <codes>`, `clear <anchor>`, `read <anchor>` or `navigate <to> <search as JSON>`. Where order runs the machine (the guarded alternatives of an event or an outcome, the effects of an `entry` or an `exit`), an item of a sequence of more than one carries its position, `#<n>`, and the lines are compared as sets. So a screen file written shorter that loads to the same flow shows no flow line.',
    'A platform action is listed by its name, and its lines as `platform action lines added in <action>` and `platform action lines removed in <action>`, one per fact it declares (`actionLines(action)`, an internal helper): each parameter with its type or the value it refers to, the constraints it writes, each as JSON, and `optional` when it may be left out (`param email: string`, `param login: value email, maxLength 100`, `param kind: string, enum ["a","b"]`), its result (`result: <the text>`, the one prose that stays, since it says what holds once the action succeeds), each code its failure shows (`code rate-limited`), each role that may run it (`role <role>`), its page sizes when it pages (`paged by 10, 25, 50, 25 by default`), each read it changes (`changes organisations.invitations`), its mail (`mail to email language locale link user.verify-email?token`: who it goes to, the language it speaks, the screen its link opens and the search parameter that carries the token) and each notice (`notice password-changed to account language account link user.forgot-password`). An action added or removed whole shows every line, as nothing else in the summary says its mail.',
  ].join('\n\n'),
  keys: [],
}

const descriptionPlaces: ReferenceRule = {
  id: 'description-places',
  title: 'Written descriptions: their place and their length in the diff',
  text: [
    "`readDescriptions(root)` reads every description the domain files write, as they write them, never one the engine derives or the loader fills in as it expands a shorter form: the screen files (a screen's own, its route parameters', its anchors', its container `states`, its flow's own, sentence guards, states, regions and transitions with the outcomes of invokes and of a region's button), the platform file (its values, its actions and their parameters, its `events`, its composites' own and their items), the activities (their own, their data, sentence guards, visits and transitions) and the model (its own, each entity's, action's and field's, the subschemas of the document, an entity or a field included), each read as YAML, the model's JSON too, so each has its line. Each is a `WrittenDescription`: its `file`, `line`, JSON path `at`, `kind` (the field it is, a `DescriptionKind`), `place` and `text`. The `Contract` carries them as `descriptions`, read by `loadContract`, so the contract at a git ref has those its files write there.",
    "The place names a description alike at any ref, by what holds it, never by the depth of its path: `app-shell.theme-select`, `user.profile` (the screen's own), `user.profile state loading`, `user.profile flow`, `user.profile flow editing.save`, `user.delete-account flow deleting onError #2` (the second of its guarded alternatives), `user.profile guard nameChanged`, `user.sign-in binding /sign-in search email`, `platform action sign-up param email`, `platform event started`, `platform composite password-rules`, `model`, `model entity profile`, `model action profile.updateName`, `model field profile.name`, `activity session state profile on user.profile.sign-out-button`.",
    "`descriptionChanges(before, after, renamed)` lists, sorted by place, each description that one side adds, removes or changes, a `DescriptionChange { place, before?, after? }` with its length in characters on each side it has, a renamed anchor's under its new name: `app-shell.theme-select 191 -> 340` (a shrink alike, `340 -> 191`), `new -> 120` for one added, `340 -> gone` for one removed, and the same length on both sides for a text changed at its length. It prints last, as `descriptions changed: <place> <before> -> <after>, ...`, so a description that grows clause by clause shows on review even where nothing that runs changed. Each description keeps the budget of its field (see the rule `check-files`).",
  ].join('\n\n'),
  keys: [],
}

const handOver: ReferenceRule = {
  id: 'hand-over',
  title: 'Handing over a change',
  text: [
    'A change to the contract goes with the output of `bun run contract:diff main` in its description (the screens, anchors, codes, entities, fields and activities added, removed or renamed, the composites added or removed, the derived parts, the codes, the states, the roles and the error fields the anchors both sides hold gain or lose, the messages among them that rank their codes, with their order, when each anchor shows by its `with` and `without` entries, who each route serves, the search parameters of each route, the platform action each list reads with its params and its paging, the platform actions added or removed and the notices they declare, the transitions added or removed in each activity both sides hold, the lines of the flow added or removed in each screen both sides hold with a flow, the lines of each platform action added, removed or changed, the reads each action of the model comes to change or stops changing, and each written description added, removed or changed with its length before and after), and below it, by hand, the reason for each rename or removal, since those break whoever reads the old name:',
    [
      '```text',
      '<the output of bun run contract:diff main>',
      '',
      'Why:',
      '- <each anchor, code, screen, entity, field, activity or transition renamed or removed>: <the reason>',
      'Scenarios and tests changed with it: <scenario ids>',
      '```',
    ].join('\n'),
    'For example, renaming the revoke button of the devices page:',
    [
      '```text',
      'contract changes: 1 anchor renamed',
      'anchors renamed: device.list.revoke-button -> device.list.sign-out-button',
      '',
      'Why:',
      '- device.list.revoke-button: the button signs the device out, and the anchor now says so',
      'Scenarios and tests changed with it: device/base/my-devices',
      '```',
    ].join('\n'),
    "The tests are in this repository, so the same change updates them, and the consumers check fails until it does. This is the delivery of a finished change; the review before the code is the owner's process of work.",
  ].join('\n\n'),
  keys: [],
}

/** The rules of the hand-over diff. */
export const HANDOFF_RULES: readonly ReferenceRule[] = [
  contractDiff,
  contractDiffLines,
  descriptionPlaces,
  handOver,
]
