/**
 * Reads the screens and the platform. Each `.yaml` file under `contract/domain/screens`, at any
 * depth and sorted by path, is one screen, named by the path of its first binding
 * (`screenFile`); `contract/domain/platform.yaml` holds the contract version and the platform
 * section. Each file is YAML, then its Zod schema. A missing or empty folder, a file that
 * is not `.yaml`, a file named otherwise than its screen's first binding says and a
 * missing platform file are problems of the file or folder concerned. Once every file is
 * read, what a file leaves to the contract is derived (`derive/`): an error anchor's codes and
 * fields from the failures of the actions its part binds, as the model and the platform give
 * them, and whether a field holds input, from its kind and its bindings. A file may author its flow in the shorter forms (a transition as its target, an effect
 * by its name, a region by its pattern or its button, the region of a button left out): each
 * flow is expanded with the codes the anchors of all screens carry, the failures of the
 * actions, the screen's buttons and the frame's toast anchor, which says the success of each
 * model action a flow invokes (`expand-flow/toasts.ts`); that anchor then carries every code a
 * flow shows on it (`derive/toasts.ts`), and each screen is parsed as every reader takes it, its
 * flow canonical. Once every file loads, they are assembled into one `ScreensFile`, each
 * screen with its file, with the toasts the loader derived.
 */

import { join } from 'node:path'

import { isRecord } from '../../records'
import { platformFileSchema } from '../../schemas'
import {
  type FailureOf,
  failuresOf,
  toastCodesOf,
  withDerivedErrors,
  withDerivedInputs,
  withToastCodes,
} from '../derive'
import type { DerivedToast } from '../expand-flow'
import { filesUnder } from '../files-under'
import { loadModel, type Model } from '../model'
import { parseFile } from '../parse-file'
import { PLATFORM_FILE, SCREENS_DIR } from '../paths'
import type { Problem } from '../problems'
import { readYaml } from '../read-yaml'

import { codesOfRead, type Lookups, toastOfRead, writesToastCodes } from './lookups'
import { expandedOf, parsedOf } from './screen-file'
import type { PlatformFile, Screen, ScreensFile } from './types'

const SUFFIX = '.yaml'

function readScreenFiles(
  root: string,
  failureOf: FailureOf,
  platformToasts: Readonly<Record<string, string>>,
): {
  screens: Screen[]
  files: string[]
  problems: Problem[]
  toasts: DerivedToast[]
} {
  const screens: Screen[] = []
  const files: string[] = []
  const paths = filesUnder(join(root, SCREENS_DIR))

  if (paths === undefined || paths.length === 0) {
    const message = paths === undefined ? 'cannot read the folder' : 'holds no screen file'

    return { screens, files, problems: [{ file: SCREENS_DIR, message }], toasts: [] }
  }

  const problems: Problem[] = []
  const read: Array<{ file: string; value: unknown }> = []

  for (const path of paths) {
    const file = `${SCREENS_DIR}/${path}`

    if (path.endsWith(SUFFIX)) {
      const yaml = readYaml(root, file)

      problems.push(...yaml.problems)

      if (yaml.problems.length === 0) {
        read.push({ file, value: withDerivedInputs(withDerivedErrors(yaml.value, failureOf)) })
      }
    } else {
      problems.push({
        file,
        message: `not a screen file: the folder holds \`<pathname>${SUFFIX}\` files only`,
      })
    }
  }

  const values = read.map(({ value }) => value)
  const lookups: Lookups = {
    codesOf: codesOfRead(values),
    failureOf,
    toast: toastOfRead(values),
    platformToasts,
  }
  const expanded = read.map(({ file, value }) => ({ file, ...expandedOf(file, value, lookups) }))
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
      const loaded = parsedOf(
        file,
        toast === undefined ? value : withToastCodes(value, toast, codes),
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
    toast !== undefined && writesToastCodes(values, toast)
      ? []
      : [...derived.values()].filter(({ code }) => !written.has(code))

  return { screens, files, problems, toasts }
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
  } = readScreenFiles(root, failureOf, platform?.toasts ?? {})
  const problems = [...screenProblems, ...platformProblems]

  if (problems.length > 0 || platform === undefined) {
    return { problems }
  }

  const { version, ...section } = platform

  return { screens: { version, screens, files, platform: section, toasts }, problems: [] }
}

/**
 * The screens and the platform, derived from the model when it loads; the model's own problems
 * are the model loader's to report (`loadModel`).
 */
export const loadScreens = (root: string): { screens?: ScreensFile; problems: Problem[] } =>
  loadScreensWith(root, loadModel(root).model)
