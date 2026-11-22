/**
 * What a screen leaves out: what it would only repeat of the model, the platform and its own
 * bindings, which the loader derives the same way every time. The derivations of an action's
 * failures, of a button's params, of an error's codes and fields, of the fields that hold input,
 * of their states and of a field that shows no state colour, of the leaves that ask first, of a platform composite, of what an element's
 * kind implies, of a link's roles, of the search parameter of a mail's link and of the
 * descriptions the engine says itself; the derivations that shape a flow are in `outcomes.ts`.
 */

import type { ReferenceRule } from '../rule'

const failureCodes: ReferenceRule = {
  id: 'failure-codes',
  title: 'What an action fails with',
  text: [
    "A platform action fails with the codes `platform.yaml` declares for it. An action of the model fails with `forbidden` first when its entity says who may change it (`x-perch.can`), then with the codes of the fields its parameters set, then with `failed`. A field gives, from its JSON Schema: `<field>-required` for a `minLength` of 1, `<field>-too-short` for a larger one, `<field>-too-long` for a `maxLength`, `<field>-invalid` for a `pattern` or a `format`, and `<field>-taken` when the field alone is unique (`x-perch.unique`); a new id and a read-only field give none, and a field's name is kebab-case in a code. So `note.createNote` fails with `forbidden`, `text-required`, `text-too-long` and `failed`, and a `maxLength` added to a field adds its code wherever an action sets the field.",
    '`contract:diff` lists the codes the anchors gain or lose, written or derived, so a constraint added to the model shows on review as the codes it adds.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.codes', 'screen.anchors.<name>.fields'],
}

const buttonParams: ReferenceRule = {
  id: 'button-params',
  title: "A button's params",
  text: [
    'A `button` whose binding names an action gets, for that action, every param the fields of its part (`<part>.<name>`: an input, a textarea, a select, a checkbox, a radio or a switch) pass in their own bindings of it. The email and password inputs of `user.sign-in` pass `email` and `password` to `platform.sign-in`, so `user.sign-in.submit-button` binds it as `action: platform.sign-in` alone. A param the button writes wins, key by key, so a value no field of its part passes stays written: its binding of `platform.sign-up` keeps `locale: app-shell.locale-select`, an anchor of the frame. Two fields that pass one param with different values are a problem of the button until it writes that param.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.binding', 'screen.anchors.<name>.binding.params'],
}

const errorCodes: ReferenceRule = {
  id: 'error-codes-and-fields',
  title: "An error's codes and fields",
  text: [
    'An error `<part>.error` that writes no `codes` carries the codes of three sources, each once, `failed` last: the failures of the actions the anchors of its part bind (`<part>.<name>`, in the order they are declared); then the failures of the actions the flow invokes and shows on it, by a written `onError` in any form or by the request pattern (see the rule `request-outcome`), a region written `by` a button included; then the codes the flow shows on it explicitly, `show: { <error>: [codes] }` in an `entry`, an `exit` or a transition. So `user.reset-password.error` may leave its codes out: the failures of `platform.reset-password`, which the anchors beside it bind, then `passwords-differ`, which its flow shows on it, then `failed`.',
    'Its `fields` map each code that concerns a parameter to the control its binding or the invoke passes for that parameter (`name-too-long` to `user.profile.name-input`), when that control is a field of the screen: a code a field of the model gives, and from version 3 a code a platform action attributes to a parameter (see the rule `attributed-codes`). A written entry names a field of the screen or `form`, the form as a whole, which is no anchor. Before version 3 a written `fields` replaces the derived one whole, and a code that two sources pass from two controls concerns the form. From version 3 the written entries merge over the derived ones, code by code, and the loader refuses, at the error, a code it carries that two controls pass and the file does not write (it writes the field it concerns or `form`), and a written entry equal to the derived one (derived; leave it out). The codes and the error fields the anchors gain or lose, written or derived, are listed by `contract:diff` as `<anchor> <code>` and `<error> <code> -> <field>` (`-> form`).',
    "On `anchors.<name>.codes` as a screen file writes it: The `data-code` values the element carries, on a `message`, `error`, `toast` or `dialog` (a dialog's code names what it asks, since every dialog looks alike): each a code of the vocabulary's Codes table, which holds its meaning, or a toast code the loader derived. Tests and agents assert the code, never the wording; a domain code (`profile:FORBIDDEN`) is mapped to a contract code (`forbidden`) in the presentation layer and never reaches `data-code`. An error that leaves them out carries the codes of three sources, each once, `failed` last: the failures of the actions the anchors of its part bind (`<part>.<name>` beside `<part>.error`, in the order they are declared); then the failures of the actions its flow invokes and shows on it (a written `onError` in any form, the request pattern, a region written `by` its button); then the codes its flow shows on it explicitly, `show: { <error>: [codes] }` in an `entry`, an `exit` or a transition. What the file writes wins. `contract:diff` lists the codes the anchors gain or lose, written or derived, as `<anchor> <code>`. On an `error`, `failed` shows for a failure whose code it does not list, and for one with no code. See the rule `error-codes-and-fields`.",
    "On `anchors.<name>.fields` as a screen file writes it: An error's codes, each with the field of the screen it concerns, which the error shows under and marks invalid, or with `form`, the form as a whole; a code the resolved map leaves out concerns the form (from version 3 a code the file leaves out keeps its derived field, and `form` written for a code overrides a derived field), and an error may leave both its `codes` and its `fields` out. Every other code shows beside the controls of its part (rule `error-placement`). Each code a field of the model gives, and from version 3 each code a platform action attributes to a parameter, goes to the control the binding or the invoke passes for that field or parameter (`name-too-long` to `user.profile.name-input`), when that control is a field of the screen. Before version 3 a written `fields` replaces the derived one whole, and a code two sources pass from two controls concerns the form; from version 3 the written entries merge over the derived ones code by code, a code two controls pass is a problem until the file writes it (a field or `form`), and an entry equal to the derived one is a problem: leave it out. `contract:diff` lists them as `<error> <code> -> <field>` (`-> form`), written or derived. See the rule `error-codes-and-fields`.",
    "In the manifest, `anchors.<name>.fields`: An error's codes, each with the field of the screen it concerns, which the error shows under and marks invalid, or with `form`, the form as a whole; a code left out concerns the form. Every other code shows beside the controls of its part (rule `error-placement`).",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.codes',
    'screen.anchors.<name>.fields',
    'manifest.screens.anchors.<name>.fields',
  ],
}

const fieldHoldsInput: ReferenceRule = {
  id: 'field-holds-input',
  title: 'Whether a field holds input',
  text: [
    "Every field (`input`, `textarea`, `select`, `checkbox`, `radio`, `switch`) holds input: what is typed into it stays until an action takes it or a `clear` of its flow empties it, so a leave with it typed loses it, and the app is to ask before such a leave (see the rule `leave-questions`). A field whose own change applies it at once, and nothing else applies it, holds none: one of its bindings runs an action that takes the field itself as a parameter, an action no other anchor of its screen runs with it (the language select, the organisation select), or its own event moves its screen's search with it, a `navigate` to a path of its screen whose `search` takes `{ anchor: <the field> }` that no other anchor's event does (a filter applied on change).",
    "A field whose action a submit button also runs with it (the sign-in email), or whose search a search button moves with it (the search box of the accounts), holds input, and so does one whose event moves to another screen carrying itself: that leaves rather than moves the search. A paged list's derived `size-select` holds none by its facet: its choice sets the route's `size` at once. The loader sets `holdsInput` on every field, once the flow is parsed; a written value wins. The manifest carries it, and `contract:diff` lists the fields that start or stop holding input.",
    "In the JSX no field carries `holdsInput`: the kit takes it from the generated field facts, `holdsInput: false` on a field that holds no input and on a paged list's size select, which holds none by its facet (see the rule `emitted-modules`), so the sources check refuses a `holdsInput` a view writes, `{false}` or `{true}`, and nothing is wanted of a field rendered (see the rule `check-sources`).",
    "On `anchors.<name>.holdsInput` as a screen file writes it: Left out, every field (input, textarea, select, checkbox, radio, switch) holds input: what is typed into it stays until an action takes it or a `clear` of its flow empties it, so a leave with it typed loses it, and the app is to ask before such a leave. It holds none when its own change applies it at once and nothing else applies it: one of its bindings runs an action that takes the field itself and that no other anchor of the screen runs with it (the language select), or its own event moves its screen's search with it (a navigate to a path of its screen whose search takes `{ anchor: <the field> }`) and no other anchor's event moves there with it (a filter applied on change). A field whose action a submit button also runs with it (the sign-in email), or whose search a search button moves with it, holds input, and so does one whose event moves to another screen carrying itself: that leaves rather than moves the search. A paged list's derived `size-select` holds none by its facet: its choice sets the route's `size` at once. The loader sets it on every field once the flow is parsed, and a written value wins. The manifest carries it, and `contract:diff` lists the fields that start or stop holding input. The kit takes it from the generated field facts, and a view writes no `holdsInput` (see the rule `check-sources`). See the rules `field-holds-input` and `leave-questions`.",
    "In the manifest, `anchors.<name>.holdsInput`: A field holds input: what is typed into it stays until an action takes it, so a leave with it typed loses it. False for a field whose own change applies it at once and nothing else applies it: it runs an action that takes the field, or it moves its screen's search with it. What is typed also goes when a `clear` of its flow empties the field.",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.holdsInput',
    'screen.anchors.<name>.marksState',
    'manifest.screens.anchors.<name>.holdsInput',
  ],
}

const fieldStatesCarried: ReferenceRule = {
  id: 'field-states-carried',
  title: 'Which states a field carries',
  text: [
    'A field of kind `input`, `textarea` or `select` that holds input carries `data-state` `unsaved` while it holds input no save has taken. One whose binding is a model field (`binding: { model: ... }`) also carries `saved` once a save stored what it shows, for as long as it stays on the screen; a reload or leaving the screen clears it. A field that holds no input (`holdsInput: false`) carries no state. The states come from the vocabulary\'s "Field states" section, and a vocabulary without it declares none. The manifest lists each field\'s states under `fieldStates` in `ids`, and the table of them under `contract.fieldStates`. A scenario pair `[field] carries [state:x]` is held to them. The implementation carries `unsaved` on a field while it holds input no save has taken, and `saved` only when its manifest `fieldStates` lists it and a save stored what it shows, while it stays on the screen; otherwise no state. `marksState: false` turns off the colour a field shows for its state; its `fieldStates` still hold.',
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.states',
    'screen.anchors.<name>.holdsInput',
    'screen.anchors.<name>.marksState',
  ],
}

const stateColour: ReferenceRule = {
  id: 'state-colour',
  title: 'A field that shows no state colour',
  text: [
    "`marksState: false` on a field: The field shows no state colour: its border keeps the untouched colour whatever its `data-state`; for a field where fresh input is the point (an entry form). Left out: the field shows it. Only on an `input`, a `textarea` or a `select` that holds input, and never on a form: `contract:check` refuses it elsewhere. The kit takes it from the generated field facts, and a view writes no `marksState` (see the rule `check-sources`). The manifest carries it in `ids` (the app leaves the border uncoloured; the field's `fieldStates` still hold), and `contract:diff` lists the fields that drop their colour as `<anchor> shows no state colour`.",
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.marksState', 'manifest.screens.anchors.<name>.marksState'],
}

const leaveQuestions: ReferenceRule = {
  id: 'leave-questions',
  title: 'Which leaves ask first',
  text: [
    "`platform.yaml` declares under `unsavedInput` every leave that would lose what was typed, and how the app asks first. `question` names the frame's dialog: a reserved dialog whose code names what it asks, its confirm-button lets the leave go on and its cancel-button stays; it runs no action of its own. `screen` (a link, Back, Forward) and `actions` (a control bound to an action listed under `leaving`, such as a sign-out) ask through it (`question`) or `never`. `unload` (a reload, closing the tab, an address typed by hand) is the browser's own prompt (`browser`), drawn outside the page, so no anchor or code marks it, or `never`. `state` (a tab, a search parameter inside one screen) is `never` or `question`; `flow` (a navigation a flow makes after its action completed: the action took the input) is always `never`, and `elsewhere` (another tab or device, a database that will not open) always `cannot`. The manifest carries it, and `contract:diff` lists a change of it. `leaving` comes with `unsavedInput`, and the question is a reserved dialog with a code and both answers that runs no action of its own.",
    "A flow's `navigate` is one of these leaves by what moves it: after an invoke's outcome it is `flow`; on a platform or data event, `elsewhere`; on a control's event, to the path of the screen's one binding, `state`; on a control's event, to any other path, `screen`, a leave the user starts as with a link. Such a control asks the frame's question before its event while a change of screen asks, as long as a field it loses holds unsaved input: the fields of its screen that hold input, but those the move carries in its search and the control itself. The loader derives it on the control, `leaves: { dialog, loses }`, which a screen file never writes, and `contract:diff` lists it as `<anchor> leaves losing <field>, <field>`.",
    "For that question to hold wherever the control is acted on, a navigate sits on a transition, never in an entry or an exit; one transition moves once; a control's navigate names a control of the flow's own screen, outside the frame, an anchor it declares or a part one derives, which has no declaration to carry the question and so moves within its screen only; a move to a path of its own screen needs a screen of one binding; and a control that leaves its screen leaves it in every branch of every state that handles it, losing the same fields, since its question comes before its event.",
    "On the platform's `leaving`: The actions whose run leaves what the user typed behind (a sign-out, a switch of organisation, a change of language), as a binding names them: the app is to ask before one runs while a field holds unsaved input.",
  ].join('\n\n'),
  keys: ['platform.unsavedInput', 'platform.leaving', 'screen.anchors.<name>.holdsInput'],
}

const composite: ReferenceRule = {
  id: 'composite-of-the-platform',
  title: 'A composite of the platform',
  text: [
    "A list with its items that several screens show, where the policy behind it lives in the platform, is declared once in `platform.yaml` under `composites`: its `description`, its `list` (the last segment of the list, ending in `-list`), its `itemState` (a row state each item takes once what it says holds) and its `items`, each by name with its description. A secret input opts in with `composite: <name>`, and the loader declares on its screen `<screen>.<list>` (kind `list`, the composite's description) and `<screen>.<list>.<item>-item` (kind `item`, the item's description, `states: [ <itemState> ]`), right after the input, each marked `derivedFrom`. The rules a new password keeps, which `user.sign-in`, `user.reset-password` and `user.settings` each show under their new password, in `domain/platform.yaml`:",
    [
      '```yaml',
      'composites:',
      '  password-rules:',
      '    description: The rules a new password keeps, each marked once the password typed keeps it.',
      '    list: password-rule-list',
      '    itemState: met',
      '    items:',
      '      length: 10 to 35 characters.',
      '      digit: At least one digit.',
      '```',
    ].join('\n'),
    'The new password of `domain/screens/reset-password.yaml` opts in, and its screen gets `user.reset-password.password-rule-list`, `user.reset-password.password-rule-list.length-item` and `user.reset-password.password-rule-list.digit-item`, none of them written:',
    [
      '```yaml',
      'user.reset-password.password-input:',
      '  kind: input',
      '  secret: true',
      '  composite: password-rules',
      '  binding:',
      '    action: platform.reset-password',
      '    params:',
      '      password: user.reset-password.password-input',
      '```',
    ].join('\n'),
    "A composite's anchors are declared anchors the loader derives, not derived parts (`user.settings.password-rule-list.digit-item` is screen `user.settings`, kind `item`); they follow the anchor grammar, and no screen file writes them. The derived list and items are declared anchors like any other: the flow's guards, the scenarios, the tests and the sources name them as they name any. An unknown composite, an opt-in on anything but a secret input, a second opt-in of one composite on a screen, a written anchor whose id a composite derives, two composites deriving one anchor and a `derivedFrom` a screen file writes are problems. The platform's composites and the rows of the vocabulary's \"Composites\" table name each other, each item state a row state: the table names each composite with what it is for. The manifest lists them in `contract.composites`, the declarations under `platform.composites`, a secret input's `composite` and `derivedFrom` on the anchors a composite derives (`{ composite }` on its list, `{ composite, item }` on an item), and `contract:diff` reports a composite added or removed. A composite declared and used by no screen is no problem: `contract:coverage` notes it (`composite <name> is declared and used by no screen`).",
    "On `anchors.<name>.composite`: The platform composite the field opts into (`password-rules`), one declared once in `platform.yaml` under `composites` where its policy lives: the loader declares on the field's screen `<screen>.<list>` (kind `list`, the composite's description) and `<screen>.<list>.<item>-item` (kind `item`, the item's description, `states: [ <itemState> ]`), right after the input, each marked `derivedFrom`. Only a secret `input` opts in. The derived list and items are declared anchors like any other: the flow's guards, the scenarios, the tests and the sources name them as they name any. Refused: an unknown composite, an opt-in on anything but a secret input, a second opt-in of one composite on a screen, a written anchor whose id a composite derives, two composites deriving one anchor, and a `derivedFrom` a screen file writes. See the rule `composite-of-the-platform`.",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.composite',
    'platform.composites',
    'platform.composites.<name>',
    'manifest.screens.anchors.<name>.composite',
  ],
}

const kindParts: ReferenceRule = {
  id: 'kind-parts',
  title: "What an element's kind implies",
  text: [
    "From version 4 an anchor's kind says what a file would only repeat, and the loader derives it: a `select` carries a `data-value` on each choice (`dataValue: true`) and renders its `option`s, a secret `input` renders its `visibility-button`, and a `dialog` and a `confirmation` render their two answers, `confirm-button` and `cancel-button`. Each part is listed in the anchor's `derived`, once, after the suffixes the file writes, so every reader of `derived` and `dataValue` (the checks, the manifest, the hand-over diff, the sources check) takes the anchor as if the file wrote them.",
    'A screen file never writes one of them: `dataValue` on a select, whatever its value, and each of `option`, `visibility-button`, `confirm-button` and `cancel-button` that the kind implies, is a problem at its key (derived from its kind; leave it out). Before version 4 nothing is derived and a file writes them as before. A paged list derives its own parts by its facet (see the rule `paged-list`).',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.derived', 'screen.anchors.<name>.dataValue'],
}

const linkRoles: ReferenceRule = {
  id: 'link-roles',
  title: 'The roles of a link',
  text: [
    "A link bound to one route (`binding: { route: /me }`) is shown to the devices that route opens. From version 4 the loader gives it the `roles` of the route's binding when the route admits fewer devices than the link's own screen serves (the frame serves every role). A link to a route that admits every device its screen serves, a link of several bindings and a link to a route no screen binds get none.",
    "Roles are read by the devices they admit, never as sets of names: a device holds `guest` alone, or `identity` with any of the other roles, so `[identity, member, admin]` and `[identity]` admit the same devices (`sameAdmission` of `@workspace/ui-contract/anchors`, over the roles the bindings of the screens serve). A screen file never writes the roles the route derives: written roles that admit exactly what the route's do are a problem at the key (derived from the route; leave them out), and roles that admit fewer devices stay as the link's own. Before version 4 nothing is derived and a file writes them as before. `contract:check` reads the loaded roles as it reads written ones (see the rule `roles`).",
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.roles'],
}

const mailLinkSearch: ReferenceRule = {
  id: 'mail-link-search',
  title: "The search parameter of a mail's link",
  text: [
    "A platform action whose `mail` links to a screen names the search parameter that carries the token (`link: { screen: user.verify-email, search: token }`). From version 4 the loader gives every route of that screen that parameter, built from the platform value of the same name (`values.token`): its `type`, `enum`, bounds, `pattern`, `description` and `examples`. A screen file never writes it: a parameter of that name in a route's `search` is a problem at its key (derived from the mail link; leave it out). A mail whose `search` names no value of the platform, or a value a route cannot take (one without a `type`, or with a `format`), is a problem at its link. Before version 4 nothing is derived and a file writes the parameter as before.",
    "The parameter is the screen's key (see the rule `address-key`) when an action of the screen takes it: the first action the screen runs with `{ search: <name> }` gives the first of the `codes` of the parameter that takes it, so the `token` of `user.verify-email` carries `x-perch: { key: link-invalid }`, the first code `platform.verify-email` lists for its `token`. The first action is one the flow's initial state invokes (a parallel initial state through the declared initial state of each of its regions), then one another state invokes, as the file writes the states, then one a list takes as its source: the order the file writes the states in changes nothing before the initial one. A parameter that lists no `codes`, and an action of the model, give no key.",
    'No control of the page sets this parameter, a link carries it: when its platform value has an `enum`, the check wants no control for the values under `x-perch.values`, which the other enums of a route, a page choice, still need.',
    "On `mail.link.search`: The search parameter of that screen's route the link carries its token in. From version 4 the loader gives every route of the screen that parameter, from the platform value of the same name. See the rule `mail-link-search`.",
  ].join('\n\n'),
  keys: ['screen.bindings.search.properties.<name>', 'platform.actions.<name>.mail.link.search'],
}

const mailRecipients: ReferenceRule = {
  id: 'mail-recipients',
  title: 'Where a mail goes and in which language',
  text: [
    "On `mail.language`: Where the mail's language comes from: a parameter of the action that holds one of the app's languages; `account`: the settings of the account the action acts on once it has them, else the language it signed up in; or `recipient`: the account whose email the mail goes to, read the same way, else the signed-in account's.",
    "On `notices.language`: Where the mail's language comes from: a parameter of the action that holds one of the app's languages, or `account`: the settings of the account the action acts on once it has them, else the language it signed up in.",
    'On `mail.to`: The parameter of the action whose value the mail goes to, or `account`: the email of the account the action acts on, the signed-in account for an action on its own account, else the one its parameters name.',
    'On `notices.to`: The parameter of the action whose value the notice goes to, or `account`: the email of the account the action acts on, as it was before the action changed anything (an email changed is told to the old address).',
  ].join('\n\n'),
  keys: [
    'platform.actions.<name>.mail.language',
    'platform.actions.<name>.mail.to',
    'platform.actions.<name>.notices.language',
    'platform.actions.<name>.notices.to',
  ],
}

const engineDescriptions: ReferenceRule = {
  id: 'engine-descriptions',
  title: 'A description the engine can say',
  text: [
    "An anchor's `description` may be left out where the engine says it: a `heading` names its screen by its title; a `link` whose one binding is a route to a screen's path leads to that screen; a secret `input` holds a secret the user types and never shows; an `error` says why the actions bound beside it, then those its flow invokes against it, did not go through, each of its codes with its meaning from the vocabulary's \"Codes\" table, the one place a code's meaning lives; and a composite's anchors carry the platform's descriptions. The manifest carries the written description, a secret input's with `(type password)` appended once, else the derived one, and gives each derived part in `contract.derivedParts` the meaning of its suffix. `bun run contract:coverage --descriptions` lists the written descriptions the engine would say itself, for the developer to drop (an anchor a composite derives is never listed).",
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.description'],
}

const descriptionPurposes: ReferenceRule = {
  id: 'description-purposes',
  title: "What a screen's and an element's description say",
  text: [
    "A screen's `description`: What the screen is for: the task it serves and when it is shown, in one or two sentences, so an agent chooses the screen before reading its anchors. Not a list of its parts: each anchor has a description of its own. At most 200 characters.",
    "An anchor's `description`: What the element is for. Its kind, binding, codes, states, roles and the flow say the rest, and what the engine says itself (a heading, a link to a screen, a secret input, an error) is left out. At most 200 characters.",
  ].join('\n\n'),
  keys: [
    'screen.description',
    'manifest.screens.description',
    'screen.anchors.<name>.description',
    'manifest.screens.anchors.<name>.description',
  ],
}

const whatStays: ReferenceRule = {
  id: 'what-stays',
  title: 'What stays in a screen',
  text: [
    "What a screen would only repeat of the model, the platform and its own bindings, it leaves out, and the loader derives it, the same way every time. What stays in a screen is what a tester or a user can tell apart: the areas and their states, where each control leads, a success or a failure that goes elsewhere than the derived one or shows something else, guards, confirmations and chains of actions. A written value wins over a derived one. `bun run contract:diff <ref>` lists the codes and the error fields the anchors gain or lose, written or derived, so a constraint added to the model shows on review as the codes it adds, and the lines of each screen's flow, its states' addresses, what they render and what each guard by failure code takes among them, and every line of a flow added to or removed from a screen, descriptions aside, so a screen written shorter that loads to the same flow shows no change but the descriptions it stops writing, each listed as `<n> -> gone`.",
  ].join('\n\n'),
  keys: [],
}

/** The rules of what a screen leaves out. */
export const LEAVES_OUT_RULES: readonly ReferenceRule[] = [
  failureCodes,
  buttonParams,
  errorCodes,
  fieldHoldsInput,
  fieldStatesCarried,
  stateColour,
  leaveQuestions,
  composite,
  kindParts,
  linkRoles,
  mailLinkSearch,
  mailRecipients,
  engineDescriptions,
  descriptionPurposes,
  whatStays,
]
