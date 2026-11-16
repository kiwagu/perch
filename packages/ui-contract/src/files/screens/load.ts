/**
 * Reads the screens and the platform. Each `.yaml` file under `contract/domain/screens`, at any
 * depth and sorted by path, is one screen, named by the path of its first binding (`screenFile`);
 * `contract/domain/platform.yaml` holds the contract version and the platform section. Each file
 * is YAML, then its Zod schema. A missing or empty folder, a file that is not `.yaml`, a file
 * named otherwise than its screen's first binding says and a missing platform file are problems
 * of the file or folder concerned. Before anything is derived, the platform's values and the model
 * take their default length (from version 6, `values/default-lengths.ts`), and every step below
 * reads them so. Once every file is read, what a file leaves to the contract is
 * derived (`derive/`): a composite a secret input opts into, derived as its list and items
 * (`derive/composites.ts`); from version 4 what an element's kind implies, a select's options and
 * data value, a secret input's visibility button and a dialog's answers (`derive/kinds.ts`); the
 * params of a form's button, from what the fields of its part pass
 * to the actions it binds, a written param winning (`derive/form-params.ts`), so what follows
 * reads them as if written; the parts a paged list derives (`derive/paging.ts`); an error anchor's codes and fields from the failures of the actions
 * its part binds and its flow shows on it, as the model and the platform give them by the version
 * `platform.yaml` declares, and the codes the flow shows on it (`derive/errors.ts`); and, with a
 * confirmation on the frame, the question
 * each control of a destructive action asks before it runs (`derive/questions.ts`), the
 * confirmation carrying every code asked with. Once a screen parses, its flow canonical, the
 * guards of its password pair (`derive/pairs.ts`) and whether a field holds input are derived,
 * the latter from its kind, its bindings and the moves of its flow
 * (`derive/inputs.ts`); then each control whose flow moves to another screen asks the platform's
 * leave question before its event while a change of screen asks, losing the fields of its screen
 * the move does not carry (`derive/leaves.ts`); a file never writes that question. A file may author its flow in the shorter forms (a transition as its
 * target, an effect by its name, a region by its pattern or its button, the region of a button
 * left out): each flow is expanded with the codes the anchors of all screens carry, the failures
 * of the actions, the screen's buttons and the frame's toast anchor, which says the success of
 * each model action a flow invokes (`expand-flow/toasts/`); that anchor then carries every code a
 * flow shows on it (`derive/toasts.ts`), and each screen is parsed as every reader takes it, its
 * flow canonical. Once every screen is parsed, from version 4 the search parameter of a mail's
 * link is derived on the screen it opens (`derive/mail-links.ts`) and a link takes the roles of
 * the route it leads to, which another file may bind (`derive/link-roles.ts`). Once every file
 * loads, they are assembled into one `ScreensFile`, each screen with its file, with the toasts
 * and the questions the loader derived.
 */

import { join } from 'node:path'

import { isRecord } from '../../records'
import { platformFileSchema } from '../../schemas'
import {
  type DerivedQuestion,
  type FailureOf,
  failuresOf,
  type LoadedScreen,
  toastCodesOf,
  withDerivedComposites,
  withDerivedErrors,
  withDerivedInputs,
  withDerivedKindParts,
  withDerivedLeaves,
  withDerivedLinkRoles,
  withDerivedMailLinks,
  withDerivedPaging,
  withDerivedParams,
  withDerivedQuestions,
  withoutWrittenLeaves,
  withQuestionCodes,
  withToastCodes,
} from '../derive'
import type { DerivedToast } from '../expand-flow'
import { filesUnder } from '../files-under'
import { loadModel, type Model } from '../model'
import { parseFile } from '../parse-file'
import { PLATFORM_FILE, SCREENS_DIR } from '../paths'
import { jsonPath, type Problem } from '../problems'
import { readYaml } from '../read-yaml'
import { withDefaultLengths } from '../values'

import {
  codesOfRead,
  confirmationOfRead,
  frameWritesCodes,
  type Lookups,
  toastOfRead,
} from './lookups'
import { expandedOf, parsedOf } from './screen-file'
import type { Platform, PlatformComposite, PlatformFile, Screen, ScreensFile } from './types'

const SUFFIX = '.yaml'

function readScreenFiles(
  root: string,
  edition: number,
  failureOf: FailureOf,
  platformToasts: Readonly<Record<string, string>>,
  composites: Readonly<Record<string, PlatformComposite>>,
  unsavedInput: Platform['unsavedInput'],
  mails: Pick<Platform, 'actions' | 'values'>,
): {
  screens: Screen[]
  files: string[]
  problems: Problem[]
  toasts: DerivedToast[]
  questions: DerivedQuestion[]
} {
  const parsed: LoadedScreen[] = []
  const paths = filesUnder(join(root, SCREENS_DIR))

  if (paths === undefined || paths.length === 0) {
    const message = paths === undefined ? 'cannot read the folder' : 'holds no screen file'

    return {
      screens: [],
      files: [],
      problems: [{ file: SCREENS_DIR, message }],
      toasts: [],
      questions: [],
    }
  }

  const problems: Problem[] = []
  const read: Array<{ file: string; value: unknown }> = []

  for (const path of paths) {
    const file = `${SCREENS_DIR}/${path}`

    if (path.endsWith(SUFFIX)) {
      const yaml = readYaml(root, file)

      problems.push(...yaml.problems)

      if (yaml.problems.length === 0) {
        const unwritten = withoutWrittenLeaves(file, yaml.value)
        const composed = withDerivedComposites(file, unwritten.value, composites)
        const kinded = withDerivedKindParts(file, composed.value, edition)
        const bound = withDerivedParams(file, kinded.value)
        const paged = withDerivedPaging(file, bound.value)
        const errors = withDerivedErrors(file, paged.value, failureOf, edition)

        problems.push(
          ...unwritten.problems,
          ...composed.problems,
          ...kinded.problems,
          ...bound.problems,
          ...paged.problems,
          ...errors.problems,
        )
        read.push({ file, value: errors.value })
      }
    } else {
      problems.push({
        file,
        message: `not a screen file: the folder holds \`<pathname>${SUFFIX}\` files only`,
      })
    }
  }

  const dialog = confirmationOfRead(read.map(({ value }) => value))
  const asked = read.map(({ file, value }) => ({
    file,
    ...withDerivedQuestions(file, value, dialog),
  }))
  const asking = new Map<string, DerivedQuestion>()

  for (const each of asked) {
    problems.push(...each.problems)

    for (const one of each.questions) {
      if (!asking.has(one.code)) {
        asking.set(one.code, one)
      }
    }
  }

  const frame = asked.find(({ value }) => isRecord(value) && value['frame'] === true)

  if (dialog !== undefined && frame !== undefined && frameWritesCodes([frame.value], dialog)) {
    problems.push({
      file: frame.file,
      message: `${jsonPath(['anchors', dialog, 'codes'])}: the codes of the confirmation are derived from the questions its controls ask: the frame writes none`,
    })
  }

  const values = asked.map(({ value }) => value)
  const lookups: Lookups = {
    codesOf: codesOfRead(values),
    failureOf,
    toast: toastOfRead(values),
    platformToasts,
    edition,
  }
  const expanded = asked.map(({ file, value }) => ({ file, ...expandedOf(file, value, lookups) }))
  const { toast } = lookups
  const codes =
    toast === undefined
      ? []
      : toastCodesOf(
          expanded.map(({ value }) => (isRecord(value) ? value['flow'] : undefined)),
          toast,
        )
  const derived = new Map<string, DerivedToast>()

  for (const each of expanded) {
    problems.push(...each.problems)

    for (const one of each.toasts) {
      if (!derived.has(one.code)) {
        derived.set(one.code, one)
      }
    }
  }

  for (const { file, value } of expanded) {
    if (value !== undefined) {
      const toasted = toast === undefined ? value : withToastCodes(value, toast, codes)
      const loaded = parsedOf(
        file,
        dialog === undefined ? toasted : withQuestionCodes(toasted, dialog, [...asking.keys()]),
        edition,
      )

      problems.push(...loaded.problems)

      if (loaded.screen !== undefined) {
        parsed.push({
          file,
          screen: withDerivedLeaves(withDerivedInputs(loaded.screen), unsavedInput),
        })
      }
    }
  }

  // Codes the frame writes on its toast anchor, or a flow shows there itself, are written codes,
  // each with its own vocabulary row.
  const written = new Set(expanded.flatMap(({ writtenToasts }) => writtenToasts))
  const toasts =
    toast !== undefined && frameWritesCodes(values, toast)
      ? []
      : [...derived.values()].filter(({ code }) => !written.has(code))

  // A mail's link and a link's roles read every screen, so they wait until every file is read.
  const mailed = withDerivedMailLinks(parsed, mails, edition)
  const linked = withDerivedLinkRoles(mailed.loaded, edition)

  problems.push(...mailed.problems, ...linked.problems)

  return {
    screens: linked.screens,
    files: parsed.map(({ file }) => file),
    problems,
    toasts,
    questions: [...asking.values()],
  }
}

function readPlatform(root: string): { platform?: PlatformFile; problems: Problem[] } {
  const read = readYaml(root, PLATFORM_FILE)

  if (read.problems.length > 0) {
    return { problems: read.problems }
  }

  const parsed = parseFile(PLATFORM_FILE, platformFileSchema, read.value)

  return parsed.value === undefined
    ? { problems: parsed.problems }
    : { platform: parsed.value, problems: [] }
}

/**
 * The screens and the platform, what the screens leave out derived from the actions of `model`
 * (undefined when it does not load: an action of the model then has no failure to derive), and the
 * model those derivations read: the platform's values and the model take their default length
 * first (`withDefaultLengths`), so every reader of either takes the resolved value.
 */
export function loadScreensWith(
  root: string,
  model: Model | undefined,
): { screens?: ScreensFile; model?: Model; problems: Problem[] } {
  const { platform, problems: platformProblems } = readPlatform(root)
  // Without a platform file, whose own problem stops the load, no rule of a later version applies.
  const edition = platform?.version ?? 1
  const lengths = withDefaultLengths(platform, model)
  const failureOf = failuresOf(lengths.model, platform?.actions, edition)
  const {
    screens,
    files,
    problems: screenProblems,
    toasts,
    questions,
  } = readScreenFiles(
    root,
    edition,
    failureOf,
    platform?.toasts ?? {},
    platform?.composites ?? {},
    platform?.unsavedInput,
    { actions: platform?.actions ?? {}, values: lengths.values },
  )
  const problems = [...screenProblems, ...platformProblems, ...lengths.problems]

  if (problems.length > 0 || platform === undefined) {
    return { problems }
  }

  const { version, ...written } = platform
  const { values: _written, ...section } = written

  return {
    screens: {
      version,
      screens,
      files,
      // The values in their place, so the section keeps the order the schema gives it.
      platform: lengths.values === undefined ? section : { ...written, values: lengths.values },
      toasts,
      questions,
    },
    ...(lengths.model === undefined ? {} : { model: lengths.model }),
    problems: [],
  }
}

/**
 * The screens and the platform, derived from the model when it loads; the model's own problems
 * are the model loader's to report (`loadModel`).
 */
export const loadScreens = (root: string): { screens?: ScreensFile; problems: Problem[] } =>
  loadScreensWith(root, loadModel(root).model)

/**
 * The model as every reader takes it: each field with its default length (`withDefaultLengths`),
 * for a reader that needs the model alone; the problems of the model file and the platform file
 * and of the lengths they write, the model left out while there are any.
 */
export function loadResolvedModel(root: string): { model?: Model; problems: Problem[] } {
  const loaded = loadModel(root)
  const { platform, problems: platformProblems } = readPlatform(root)
  const lengths = withDefaultLengths(platform, loaded.model)
  const problems = [...loaded.problems, ...platformProblems, ...lengths.problems]

  return problems.length > 0 || lengths.model === undefined
    ? { problems }
    : { model: lengths.model, problems }
}
