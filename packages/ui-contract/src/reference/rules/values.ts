/**
 * The rules of a value declared once (where it is declared, how a parameter takes it, what a
 * field takes) and of a platform code on the parameter it concerns, and of the email format, which
 * the browser checks first.
 */

import type { ReferenceRule } from '../rule'

const declaredValues: ReferenceRule = {
  id: 'declared-values',
  title: 'A value declared once',
  text: [
    "A value is a type with its constraints, said once where its policy lives, so a limit no longer lives in a parameter's prose. It is a name of `platform.values` (`email: { type: string, format: email, maxLength: 254, description }`), written in the bounds of a route's flat parameter (`type`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`), an `enum` of strings and numbers, `examples` (any list of fake values) and `format`, which a route's search never takes; or a field of the model, `<entity>.<field>`, whose JSON Schema constraints it is (a format no value names left out), `readOnly` when the field is `x-perch.readonly`.",
    "A parameter of a platform action writes its `type` or the `value` it refers to, `value: <name>` or `value: <entity>.<field>`, and may write the keywords of a value beside it. A keyword written beside `value` only narrows the value: a `minLength` or a `minimum` no smaller than the value's, a `maxLength` or a `maximum` no larger, an `enum` among the value's members, a `type` or a `format` where the value has none or the same, a `pattern` where the value has none (one beside a value's own pattern is refused, the same one included); `contract:check` refuses one that would widen it or say other than it says, at the keyword (`{ value: email, maxLength: 500 }` over an email of at most 254 characters). What a parameter takes (`parameterValueOf`) is the value it refers to narrowed by those keywords (`{ value: email, maxLength: 100 }` takes at most 100 characters; a refused keyword is left out, so the value keeps its own); a paged action's `size` takes the action's sizes as its `enum`; a parameter that refers to nothing takes its own keywords, its `type` alone at least. A parameter of an action of the model takes the value of the field it sets. `optional: true` says the action runs without the parameter.",
    "The value a field takes (`fieldValueOf`) is the loosest of the values of its model binding and of every action parameter that takes it: its own action bindings and every binding of another anchor of its screen that passes it, a submit button's derived params included. So a field one form uses for two parameters (the password of a sign-in and the new one of a sign-up) accepts what either accepts, never only what the strictest does. A confirmation, an input that writes `confirms`, takes the value of the input it confirms (see the rule `password-pair`). Loosest: `minLength` and `minimum` the smallest, `maxLength` and `maximum` the largest, each kept only when every value has one; `type`, `pattern`, `format` and `enum` kept only when every value has the same; `readOnly` only when every value has it. A `{ search }` binding adds nothing, neither narrowing nor widening: the limit of a search parameter belongs to the address. An anchor that is no field, and a field with no model binding and no parameter that takes it, has no value. The manifest carries it on each `input` and `textarea` that has one, as `ids.<anchor>.value`.",
    '`contract:check` refuses a `value` that names neither a value of `platform.values` nor a field of the model, at the parameter, and a keyword beside it that does not narrow it, and holds the description of each value to the budget; a paged action\'s `page` and `size` are numbers by the type they write or take from their value. `contract:diff` lists the values added and removed by name, and of each value both sides hold each keyword whose value changes, compared as data, as `platform values changed: <name> <keyword> <before> -> <after>`, each side its JSON (`none` on the side that lacks it: `kind enum [1] -> ["1"]`); the line of each parameter of an action names its type or its value and its constraints, each as JSON (see the rule `contract-diff-lines`).',
  ].join('\n\n'),
  keys: [
    'platform.values',
    'platform.actions.<name>.params.<name>',
    'platform.actions.<name>.params.<name>.value',
    'manifest.ids.<name>.value',
  ],
}

const attributedCodes: ReferenceRule = {
  id: 'attributed-codes',
  title: 'A platform code on the parameter it concerns',
  text: [
    "From version 3 a code of a platform action concerns the parameters it is attributed to (`attributedCodes(action, platform)`, per parameter its codes in the action's order): the one it is named after, `<parameter>-<suffix>` with the parameter in kebab-case (`currentPassword` gives `current-password-rejected`), and each one whose `codes` list it (`codes: [ link-invalid ]` on a `token`); a code the action does not declare is never attributed. The suffixes are those of a field's codes (`FIELD_CODE_SUFFIXES`), each naming a constraint of the value: `required` a `minLength` of 1 or more, `too-short` a `minLength` above 1, `too-long` a `maxLength`, `invalid` a `pattern`, a `format` or an `enum`, `taken` none (any value may be taken), `rejected` any constraint. An error then derives the field a code is shown under from the control passed for its parameter, as it does for a code of the model (see the rule `error-codes-and-fields`). Before version 3 a platform code concerns no parameter.",
    "`contract:check` holds a contract from version 3 to four rules (`attributionProblems`): a parameter whose value is a string refers to a value or writes a constraint beside its `type`, at the parameter; a code that ends like the code of a field concerns a parameter, at the code; a code named after a parameter names a constraint the parameter's value has (see the rule `declared-values`), as the row of its suffix reads it, at the code; and the `codes` of a parameter are codes of its action, at the code.",
  ].join('\n\n'),
  keys: ['platform.actions.<name>.codes', 'platform.actions.<name>.params.<name>.codes'],
}

const emailFormat: ReferenceRule = {
  id: 'email-format',
  title: 'The browser refuses an email first',
  text: [
    '`format: email`: the field is `type=email`; an editable one is submitted through a form without `noValidate`, so the browser refuses a text that is no email when the form submits, before the action runs; where the action declares an `-invalid` code, it answers what passes the browser, which takes `a@b` for an email. A form that holds such a field never sets `noValidate`, which would let every text through to the action.',
    'A control that does not submit its form (a `type=button` that runs its action on click) runs the action with no browser check: the same `-invalid` code, where the action declares one, answers a text that is no email there. A read-only field of that format is `type=email` too and is submitted by no form.',
  ].join('\n\n'),
  keys: ['platform.values.<name>.format', 'manifest.ids.<name>.value.format'],
}

/** The rules of the values. */
export const VALUE_RULES: readonly ReferenceRule[] = [declaredValues, attributedCodes, emailFormat]
