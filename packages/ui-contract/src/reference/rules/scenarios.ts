/** The rules of a scenario: where its file lives, its header and body, its brackets and its test. */

import type { ReferenceRule } from '../rule'

const scenarioFiles: ReferenceRule = {
  id: 'scenario-files',
  title: 'Scenario files and their ids',
  text: [
    'A scenario is an instruction a person could follow by hand, one Markdown file each, in the e2e tree beside its test:',
    [
      '```text',
      'tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md',
      'tests/e2e/src/<entity>/<layer>/[<area>/]<slug>.e2e.spec.ts',
      '```',
    ].join('\n'),
    "The id is the file's path under `tests/e2e/scenarios/` without `.md`, never written inside the file: `user/base/edit-profile-name`. Its segments go from the general to the specific:",
    [
      '- the entity the scenario checks: `user`, `device`, `organisation`, and `contract` for the contract itself;',
      '- the layer: `base` (the entity works on its own; an area such as `crud` or `list` when it helps), `flows` (several roles or devices meet) or `features` (how one function behaves);',
      '- an optional area, then a kebab-case slug.',
    ].join('\n'),
    'No numbers: the tree orders the scenarios and the tags select them. The role is a property of the scenario, in its front matter, never a folder. A path that does not match `^[a-z][a-z0-9-]*(\\/[a-z][a-z0-9-]*){2,3}$`, or whose layer is not one of the three, is a problem of its file. The scenarios are sorted by id, an id before the ids that extend it (`user/base/sign-up` before `user/base/sign-up-taken-email`).',
  ].join('\n\n'),
  keys: ['manifest.scenarios.id'],
}

const scenarioFormat: ReferenceRule = {
  id: 'scenario-format',
  title: 'The header and the body of a scenario',
  text: [
    'The file opens with a YAML front matter that holds only the structured header:',
    [
      '- `tags`: a list holding `smoke` or `full`;',
      '- `activity`, when the scenario walks one: the id of an activity of `contract/domain/activities/`;',
      '- `devices`: a letter per browser with the role it acts as by the end of the scenario; every device starts as `guest` until a step signs it in;',
      '- `data`: the test data by name, `generate` or a fixed string; `{}` when there is none.',
    ].join('\n'),
    'Then the body, with fixed sections in any order: `# <title>`, a line `Where: <text>`, `## Scenario: <sentence>`, `### Steps` with a numbered list and `### Expected result` with a bullet list. An unknown heading, a line outside a section, a missing section or a list item of the wrong shape is a problem, with a line number where the parser knows it (a missing section has none). A whole scenario, `tests/e2e/scenarios/user/base/edit-profile-name.md` as it reads with its places named by their screens:',
    [
      '```markdown',
      '---',
      'tags:',
      '  - smoke',
      'devices:',
      '  A: identity',
      'data:',
      '  New name: generate',
      '---',
      '# Rename yourself on the profile page',
      '',
      'Where: [screen:user.profile] then [user.profile.save-button]',
      '',
      '## Scenario: A signed-in user changes their name and keeps it after a reload',
      '',
      '### Steps',
      '1. Open [screen:user.profile] and wait for [app-shell.status] to reach [state:ready]',
      '2. Clear [user.profile.name-input]',
      '3. Enter the new name into [user.profile.name-input]',
      '4. Click [user.profile.save-button]',
      '',
      '### Expected result',
      '- After step 4 [app-shell.toast] carries [code:profile-saved]',
      '- [user.profile.heading] shows the new name',
      '- Reloading the page keeps the new name',
      '```',
    ].join('\n'),
    'A scenario that walks an activity names it in its front matter (`activity: session`), and the coverage note counts, per activity, the scenarios that name it and the transitions they walk. `parseScenario(id, markdown)` reads one into a `Scenario` with `lines`, the line of each key of the front matter (`devices.A`), each section (`where`) and each list item (`steps[0]`), or returns its problems with their lines; `formatScenario(scenario)` writes one, its inverse.',
  ].join('\n\n'),
  keys: [],
}

const scenarioBrackets: ReferenceRule = {
  id: 'scenario-brackets',
  title: 'The brackets of a scenario and what they pair with',
  text: [
    "Brackets reference the contract, and the contract check resolves each one: `[<anchor>]` (a declared anchor, or one derived from a declared base with a suffix it lists), `[screen:<screen>]` (a place, by the id of its screen: the address of the screen's first binding, the binding its file is named by, so a path is written once, in its binding; a screen that no binding opens is a problem), `[/path]` (only the path of a screen's further binding, which no screen id names), `[code:<code>]`, `[state:<state>]`, `[value:<value>]` and `[mail:<action>]` (a platform action that declares the mail it sends) and `[notice:<action>.<name>]` (a notice of that name the platform action declares). A value `show` or `hide` is one of the contract once an input renders a `visibility-button`.",
    "In one text (the `Where` line, the scenario sentence, a step or an expected result), a `[code:…]`, a `[state:…]` or a `[value:…]` speaks of the anchor the text names last before it, and the check wants it to be one that anchor carries: a code of its codes, written or derived, a state of its `states`, a value of its choice values, its own or those of an anchor declared under it (`<anchor>.<rest>`: the items of a composite's list, the options of a select, the eye of an input). So `[user.sign-in.mail-message] carries [code:check-your-mail]` holds, and `every item of [user.sign-in.password-rule-list] carries [state:met]` holds through the list's items, while `[user.confirm-email.error] carries [code:welcome]` is a problem, `user.confirm-email.error never carries code welcome`.",
    "A place, named by its screen or by its path, is read past: in `wait for [app-shell.status] to reach [state:ready] on [screen:user.profile]` the state is the status's. A `[mail:…]` or a `[notice:…]` ends the pairing until the text names an anchor again, since what follows speaks of the mail or the notice (its language, its link). With no anchor before it in its text, a code, a state or a value need only be one of the contract. Write the anchor first, then its code, its state or its value: a value written before its anchor pairs with an anchor the text named earlier, if any. `Choose [value:dark] in [user.settings.theme-select]` holds the value to the contract alone, and `[user.settings.theme-select] shows [value:dark]` holds it to the select. `referencesIn(text)` reads the bracket references of a text in the order it writes them, `anchorCarries(contract)` says whether an anchor carries a code, a state or a value (one it declares or one an anchor under it declares: codes are the loaded `codes`, derived ones included; states the anchor's `states`; values the rows of its choice values and its options', a pattern row matching, or `show` and `hide` on a `visibility-button`), and `pairingResolver(contract)` says why a value does not pair with its anchor, for the scenarios and the consumers check alike.",
    "A place is never named by the path of its screen's first binding: such a `[/…]` is a problem that names the screen to write (`names a place by its path: write [screen:<id>]`), and a path no binding has is one too, since the path is stated once, in the binding, and a change of it changes no scenario. The check also holds each device to a role of the contract, the activity a scenario names to exist, a mail to the platform action that declares it and a notice to its action and its name (`unknownNotice`).",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.codes',
    'screen.anchors.<name>.states',
    'screen.anchors.<name>.dataValue',
  ],
}

const scenarioTests: ReferenceRule = {
  id: 'scenario-tests',
  title: 'The test of a scenario, and the feedback loop',
  text: [
    'The test pairs with the scenario by its path and names it on its first line, `// scenario: user/base/edit-profile-name`, with one `test.step` per step. `bun run e2e:scaffold <id>` writes a failing test from a new scenario, and `bun run e2e:coverage` checks the pairs, step for step: it runs in `bun run check` and in the pre-commit hook on a commit on `main`, while on a branch the hook leaves it out, so a scenario may wait for its test. The test of the scenario locates by anchors and asserts codes, states and values, never wording.',
    "The scenarios are the contract's feedback loop. A scenario is written from the contract alone: when it needs an anchor, a code, a state, a route or a role the contract lacks, that gap is fixed in the contract files first, never worked around in a test. A gap the contract cannot close in the change is signalled, never emulated.",
  ].join('\n\n'),
  keys: [],
}

/** The rules of a scenario. */
export const SCENARIO_RULES: readonly ReferenceRule[] = [
  scenarioFiles,
  scenarioFormat,
  scenarioBrackets,
  scenarioTests,
]
