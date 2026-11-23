/**
 * The forbidden synonyms of the terms file: a word a term or a role names as its synonym never
 * stands in the contract's texts or in what the engine emits from it. The texts are every written
 * description (`readDescriptions`: the screens', the platform's, the activities', the model's and
 * the terms' own meanings), every behaviour text of the platform (an outcome line, a code's
 * condition, an invariant's rule), every platform action's name and every screen's id. What the
 * engine emits from them is read too: the route path of each binding and the name of each role
 * (`CONTRACT_ROUTES`, `CONTRACT_ROLES`), the name and the enum of each platform value and of each
 * field of the model (`CONTRACT_VALUES`), and the name of each declared anchor (`FIELD_FACTS`
 * and the code that renders it). A synonym is read as
 * whole words in any case, its words apart by anything that is not a letter or a digit (a space, a
 * dash, a dot, a slash), its last word also with a plural `s` or `es` (`tenants`); never as a part
 * of a word (`tenancy`). Each synonym is named once per text, at its first place there, with the
 * term or role to write instead. Code and storage keep their names: this reads the contract only.
 */

import { jsonPath, MODEL_FILE, type Problem, TERMS_FILE, type Terms } from '../files'

import { BEHAVIOUR_NOUNS, behaviourTexts } from './behaviour-texts'
import { type Contract, inFile, locate } from './contract'

/** A synonym the terms file forbids, with the term or the role it stands for. */
interface Forbidden {
  readonly pattern: RegExp
  readonly name: string
  readonly kind: 'term' | 'role'
}

/** A synonym's words as one whole-word pattern: any separator between them, a plural at the end. */
const patternOf = (synonym: string): RegExp =>
  new RegExp(
    `(?<![A-Za-z0-9])${synonym.split(/[ -]/).join('[^A-Za-z0-9]+')}(?:e?s)?(?![A-Za-z0-9])`,
    'i',
  )

/** The strings of an enum, each with its place in the list. */
const enumStrings = (values: readonly unknown[] | undefined): Array<[number, string]> =>
  (values ?? []).flatMap(
    (value, index): Array<[number, string]> => (typeof value === 'string' ? [[index, value]] : []),
  )

function forbiddenOf(terms: Terms): Forbidden[] {
  return (['term', 'role'] as const).flatMap((kind) =>
    Object.entries(terms[kind === 'term' ? 'terms' : 'roles']).flatMap(([name, { synonyms }]) =>
      (synonyms ?? []).map((synonym) => ({ pattern: patternOf(synonym), name, kind })),
    ),
  )
}

/**
 * The problems of one text: `what` says it (`the outcome line`, `the screen's id`), and `problem`
 * places the message.
 */
function saidIn(
  text: string,
  what: string,
  forbidden: readonly Forbidden[],
  problem: (message: string) => Problem,
): Problem[] {
  return forbidden.flatMap(({ pattern, name, kind }) => {
    const written = pattern.exec(text)?.[0]

    return written === undefined
      ? []
      : [problem(`${what} says "${written}", a synonym of the ${kind} "${name}"; write "${name}"`)]
  })
}

export function synonymsProblems(contract: Contract): Problem[] {
  const { terms, screens } = contract

  if (terms === undefined) {
    return []
  }

  const forbidden = forbiddenOf(terms)
  const inScreens = locate(screens)
  const at = (path: readonly PropertyKey[]) => (message: string) => inScreens(path, message)

  return [
    ...contract.descriptions.flatMap(({ file, line, at: path, place, text }) =>
      saidIn(text, `the description of ${place}`, forbidden, (message) =>
        inFile(file, `${jsonPath(path)}: ${message}`, line),
      ),
    ),
    ...behaviourTexts(screens.platform, true).flatMap(({ at: path, kind, text }) =>
      saidIn(text, BEHAVIOUR_NOUNS[kind], forbidden, at(path)),
    ),
    ...Object.keys(screens.platform.actions).flatMap((name) =>
      saidIn(name, "the action's name", forbidden, at(['platform', 'actions', name])),
    ),
    ...screens.screens.flatMap((screen, index) => [
      ...saidIn(screen.id, "the screen's id", forbidden, at(['screens', index, 'id'])),
      ...screen.bindings.flatMap(({ path }, binding) =>
        saidIn(
          path,
          "the route's path",
          forbidden,
          at(['screens', index, 'bindings', binding, 'path']),
        ),
      ),
    ]),
    ...Object.entries(screens.platform.values ?? {}).flatMap(([name, value]) => [
      ...saidIn(name, "the value's name", forbidden, at(['platform', 'values', name])),
      ...enumStrings(value.enum).flatMap(([index, text]) =>
        saidIn(
          text,
          "the value's enum",
          forbidden,
          at(['platform', 'values', name, 'enum', index]),
        ),
      ),
    ]),
    ...Object.entries(contract.model.entities).flatMap(([entity, { fields }]) =>
      Object.entries(fields).flatMap(([field, { enum: values }]) => {
        const inModel = (path: readonly PropertyKey[]) => (message: string) =>
          inFile(
            MODEL_FILE,
            `${jsonPath(['$defs', entity, 'properties', field, ...path])}: ${message}`,
          )

        return [
          ...saidIn(field, "the field's name", forbidden, inModel([])),
          ...enumStrings(values).flatMap(([index, text]) =>
            saidIn(text, "the field's enum", forbidden, inModel(['enum', index])),
          ),
        ]
      }),
    ),
    ...screens.screens.flatMap((screen, index) =>
      Object.keys(screen.anchors).flatMap((anchor) =>
        saidIn(anchor, "the anchor's name", forbidden, at(['screens', index, 'anchors', anchor])),
      ),
    ),
    ...Object.keys(terms.roles).flatMap((role) =>
      saidIn(role, "the role's name", forbidden, (message) =>
        inFile(TERMS_FILE, `${jsonPath(['roles', role])}: ${message}`),
      ),
    ),
  ]
}
