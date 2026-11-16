/** The rule of a value declared once: where it is declared, how a parameter takes it, what a field takes. */

import type { ReferenceRule } from '../rule'

const declaredValues: ReferenceRule = {
  id: 'declared-values',
  title: 'A value declared once',
  text: [
    "A value is a type with its constraints, said once where its policy lives, so a limit no longer lives in a parameter's prose. It is a name of `platform.values` (`email: { type: string, format: email, maxLength: 254, description }`), written in the bounds of a route's flat parameter (`type`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`), an `enum` of strings and numbers, `examples` (any list of fake values) and `format`, which a route's search never takes; or a field of the model, `<entity>.<field>`, whose JSON Schema constraints it is (a format no value names left out), `readOnly` when the field is `x-perch.readonly`.",
    "A parameter of a platform action writes its `type` or the `value` it refers to, `value: <name>` or `value: <entity>.<field>`, and may write the keywords of a value beside it. A keyword written beside `value` only narrows the value: a `minLength` or a `minimum` no smaller than the value's, a `maxLength` or a `maximum` no larger, an `enum` among the value's members, a `type` or a `format` where the value has none or the same, a `pattern` where the value has none (one beside a value's own pattern is refused, the same one included); `contract:check` refuses one that would widen it or say other than it says, at the keyword (`{ value: email, maxLength: 500 }` over an email of at most 254 characters). What a parameter takes (`parameterValueOf`) is the value it refers to narrowed by those keywords (`{ value: email, maxLength: 100 }` takes at most 100 characters; a refused keyword is left out, so the value keeps its own); a paged action's `size` takes the action's sizes as its `enum`; a parameter that refers to nothing takes its own keywords, its `type` alone at least. A parameter of an action of the model takes the value of the field it sets. `optional: true` says the action runs without the parameter.",
    "The value a field takes (`fieldValueOf`) is the loosest of the values of its model binding and of every action parameter that takes it: its own action bindings and every binding of another anchor of its screen that passes it, a submit button's derived params included. So a field one form uses for two parameters (the password of a sign-in and the new one of a sign-up) accepts what either accepts, never only what the strictest does. Loosest: `minLength` and `minimum` the smallest, `maxLength` and `maximum` the largest, each kept only when every value has one; `type`, `pattern`, `format` and `enum` kept only when every value has the same; `readOnly` only when every value has it. A `{ search }` binding adds nothing, neither narrowing nor widening: the limit of a search parameter belongs to the address. An anchor that is no field, and a field with no model binding and no parameter that takes it, has no value. The manifest carries it on each `input` and `textarea` that has one, as `ids.<anchor>.value`.",
    '`contract:check` refuses a `value` that names neither a value of `platform.values` nor a field of the model, at the parameter, and a keyword beside it that does not narrow it, and holds the description of each value to the budget; a paged action\'s `page` and `size` are numbers by the type they write or take from their value. `contract:diff` lists the values added and removed by name, and of each value both sides hold each keyword whose value changes, compared as data, as `platform values changed: <name> <keyword> <before> -> <after>`, each side its JSON (`none` on the side that lacks it: `kind enum [1] -> ["1"]`); the line of each parameter of an action names its type or its value and its constraints, each as JSON (see the rule `contract-diff-lines`).',
  ].join('\n\n'),
  keys: [
    'platform.values',
    'platform.actions.<name>.params.<name>',
    'platform.actions.<name>.params.<name>.value',
    'manifest.ids.<name>.value',
  ],
}

/** The rules of the values. */
export const VALUE_RULES: readonly ReferenceRule[] = [declaredValues]
