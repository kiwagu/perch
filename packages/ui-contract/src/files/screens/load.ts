/**
 * Reads the screens and the platform. Each `.yaml` file under `contract/domain/screens`, at any
 * depth and sorted by path, is one screen, named by the path of its first binding (`screenFile`);
 * `contract/domain/platform.yaml` holds the contract version and the platform section. Each file
 * is YAML, then its Zod schema. A missing or empty folder, a file that is not `.yaml`, a file
 * named otherwise than its screen's first binding says and a missing platform file are problems
 * of the file or folder concerned. Once every file is read, what a file leaves to the contract is
 * derived (`derive/`): a composite a secret input opts into, derived as its list and items
 * (`derive/composites.ts`); the params of a form's button, from what the fields of its part pass
 * to the actions it binds, a written param winning (`derive/form-params.ts`), so what follows
 * reads them as if written; the parts a paged list derives (`derive/paging.ts`); an error anchor's codes and fields from the failures of the actions
 * its part binds and its flow shows on it, as the model and the platform give them, and the codes
 * the flow shows on it (`derive/errors.ts`); whether a field holds input, from its kind and its
 * bindings; and, with a confirmation on the frame, the question each control of a destructive
 * action asks before it runs (`derive/questions.ts`), the confirmation carrying every code asked
 * with. A file may author its flow in the shorter forms (a transition as its
 * target, an effect by its name, a region by its pattern or its button, the region of a button
 * left out): each flow is expanded with the codes the anchors of all screens carry, the failures
 * of the actions, the screen's buttons and the frame's toast anchor, which says the success of
 * each model action a flow invokes (`expand-flow/toasts/`); that anchor then carries every code a
 * flow shows on it (`derive/toasts.ts`), and each screen is parsed as every reader takes it, its
 * flow canonical. Once every file loads, they are assembled into one `ScreensFile`, each screen
 * with its file, with the toasts and the questions the loader derived.
 */

import { join } from 'node:path'

import { isRecord } from '../../records'
import { platformFileSchema } from '../../schemas'
import {
  type DerivedQuestion,
  type FailureOf,
  failuresOf,
  toastCodesOf,
  withDerivedComposites,
  withDerivedErrors,
  withDerivedInputs,
  withDerivedPaging,
  withDerivedParams,
  withDerivedQuestions,
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

import {
  codesOfRead,
  confirmationOfRead,
  frameWritesCodes,
  type Lookups,
  toastOfRead,
} from './lookups'
import { expandedOf, parsedOf } from './screen-file'
import type { PlatformComposite, PlatformFile, Screen, ScreensFile } from './types'

const SUFFIX = '.yaml'

function readScreenFiles(
  root: string,
  failureOf: FailureOf,
  platformToasts: Readonly<Record<string, string>>,
  composites: Readonly<Record<string, PlatformComposite>>,
): {
  screens: Screen[]
  files: string[]
  problems: Problem[]
  toasts: DerivedToast[]
  questions: DerivedQuestion[]
} {
  const screens: Screen[] = []
  const files: string[] = []
  const paths = filesUnder(join(root, SCREENS_DIR))

  if (paths === undefined || paths.length === 0) {
    const message = paths === undefined ? 'cannot read the folder' : 'holds no screen file'

    return { screens, files, problems: [{ file: SCREENS_DIR, message }], toasts: [], questions: [] }
  }

  const problems: Problem[] = []
  const read: Array<{ file: string; value: unknown }> = []

  for (const path of paths) {
    const file = `${SCREENS_DIR}/${path}`

    if (path.endsWith(SUFFIX)) {
      const yaml = readYaml(root, file)

      problems.push(...yaml.problems)

      if (yaml.problems.length === 0) {
        const composed = withDerivedComposites(file, yaml.value, composites)
        const bound = withDerivedParams(file, composed.value)
        const paged = withDerivedPaging(file, bound.value)

        problems.push(...composed.problems, ...bound.problems, ...paged.problems)
        read.push({
          file,
          value: withDerivedInputs(withDerivedErrors(paged.value, failureOf)),
        })
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
      )

      problems.push(...loaded.problems)

      if (loaded.screen !== undefined) {
        screens.push(loaded.screen)
        files.push(file)
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

  return { screens, files, problems, toasts, questions: [...asking.values()] }
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
 * (undefined when it does not load: an action of the model then has no failure to derive).
 */
export function loadScreensWith(
  root: string,
  model: Model | undefined,
): { screens?: ScreensFile; problems: Problem[] } {
  const { platform, problems: platformProblems } = readPlatform(root)
  const failureOf = failuresOf(model, platform?.actions)
  const {
    screens,
    files,
    problems: screenProblems,
    toasts,
    questions,
  } = readScreenFiles(root, failureOf, platform?.toasts ?? {}, platform?.composites ?? {})
  const problems = [...screenProblems, ...platformProblems]

  if (problems.length > 0 || platform === undefined) {
    return { problems }
  }

  const { version, ...section } = platform

  return {
    screens: { version, screens, files, platform: section, toasts, questions },
    problems: [],
  }
}

/**
 * The screens and the platform, derived from the model when it loads; the model's own problems
 * are the model loader's to report (`loadModel`).
 */
export const loadScreens = (root: string): { screens?: ScreensFile; problems: Problem[] } =>
  loadScreensWith(root, loadModel(root).model)
