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

import type { z } from '@workspace/zod'

import { isRecord, recordOf } from '../records'
import {
  type anchorBindingSchema,
  type anchorDefSchema,
  type bindingRefSchema,
  type bindingSchema,
  type effectSchema,
  type flowSchema,
  type paramValueSchema,
  platformFileSchema,
  type platformSchema,
  screenFileSchema,
  type screenSchema,
  type transitionSchema,
} from '../schemas'

import {
  controlsOf,
  type FailureOf,
  failuresOf,
  toastCodesOf,
  withDerivedErrors,
  withDerivedInputs,
  withToastCodes,
} from './derive'
import { type CodesOf, type DerivedToast, expandFlow } from './expand-flow'
import { filesUnder } from './files-under'
import { loadModel, type Model } from './model'
import { parseFile } from './parse-file'
import { PLATFORM_FILE, SCREENS_DIR, screenFile } from './paths'
import { jsonPath, type Problem } from './problems'
import { readYaml } from './read-yaml'

export type Screen = z.infer<typeof screenSchema>
export type AnchorDef = z.infer<typeof anchorDefSchema>
export type Binding = z.infer<typeof bindingSchema>
export type BindingRef = z.infer<typeof bindingRefSchema>
export type AnchorBinding = z.infer<typeof anchorBindingSchema>
export type ParamValue = z.infer<typeof paramValueSchema>
export type Platform = z.infer<typeof platformSchema>
export type Flow = z.infer<typeof flowSchema>
/** A plain state of the root: it may end, carry an address and run an invoke. */
export type FlowState = Exclude<Flow['states'][string], { type: 'parallel' }>
/** A state of the root whose regions are all active at once. */
export type FlowParallelState = Extract<Flow['states'][string], { type: 'parallel' }>
/** A region of a parallel state: one independent area, in one of its states at a time. */
export type FlowRegion = FlowParallelState['states'][string]
/** A state of a region: a plain state that does not end and has no address. */
export type FlowRegionState = FlowRegion['states'][string]
export type FlowTransition = z.infer<typeof transitionSchema>
export type Effect = z.infer<typeof effectSchema>
export type PlatformFile = z.infer<typeof platformFileSchema>

/** The screen files and the platform file, assembled: the shape every rule reads. */
export interface ScreensFile {
  version: PlatformFile['version']
  screens: Screen[]
  /** The file of each screen, at the index of the screen: `contract/domain/screens/me.yaml`. */
  files: readonly string[]
  platform: Platform
  /**
   * The toasts the loader derived on the frame's toast anchor, one per code, each with the model
   * action whose success it says: the vocabulary vouches for them by one rule row.
   */
  toasts: readonly DerivedToast[]
}

const SUFFIX = '.yaml'

/** The problem of a screen kept in another file than the one its first binding names. */
function nameProblems(file: string, screen: Screen): Problem[] {
  const first = screen.bindings[0]?.path
  const named = screenFile(first)

  if (file === named) {
    return []
  }

  return [
    {
      file,
      message:
        first === undefined
          ? `a screen without bindings is the frame, whose file is ${named}`
          : `its first binding is "${first}", so its file is ${named}`,
    },
  ]
}

/** The codes each anchor of the screens as read carries, for `show: <anchor>`. */
function codesOfRead(read: readonly unknown[]): CodesOf {
  const codes = new Map<string, readonly string[]>()

  for (const screen of read) {
    const anchors = isRecord(screen) ? screen['anchors'] : undefined

    for (const [anchor, definition] of isRecord(anchors) ? Object.entries(anchors) : []) {
      const declared = isRecord(definition) ? definition['codes'] : undefined

      codes.set(
        anchor,
        Array.isArray(declared)
          ? declared.filter((code: unknown): code is string => typeof code === 'string')
          : [],
      )
    }
  }

  return (anchor) => codes.get(anchor)
}

/** The frame's toast anchor as read: the anchor of kind `toast` of the screen marked `frame`. */
function toastOfRead(read: readonly unknown[]): string | undefined {
  for (const screen of read) {
    if (isRecord(screen) && screen['frame'] === true && isRecord(screen['anchors'])) {
      const found = Object.entries(screen['anchors']).find(
        ([, def]) => isRecord(def) && def['kind'] === 'toast',
      )

      if (found !== undefined) {
        return found[0]
      }
    }
  }

  return undefined
}

interface Lookups {
  readonly codesOf: CodesOf
  readonly failureOf: FailureOf
  readonly toast: string | undefined
}

/** The screen of one file as read, its flow expanded, with the toasts the expansion derived. */
function expandedOf(
  file: string,
  read: unknown,
  lookups: Lookups,
): { value?: unknown; toasts: readonly DerivedToast[]; problems: Problem[] } {
  const flow = isRecord(read) ? read['flow'] : undefined
  const id = isRecord(read) && typeof read['id'] === 'string' ? read['id'] : ''
  const expanded =
    flow === undefined
      ? undefined
      : expandFlow(flow, { ...lookups, controls: controlsOf(read), screen: id })

  if (expanded !== undefined && expanded.issues.length > 0) {
    return {
      toasts: [],
      problems: expanded.issues.map((issue) => ({
        file,
        message: `${jsonPath(issue.at)}: ${issue.message}`,
      })),
    }
  }

  return {
    value: expanded === undefined || !isRecord(read) ? read : { ...read, flow: expanded.flow },
    toasts: expanded?.toasts ?? [],
    problems: [],
  }
}

/** The screen of one file, expanded, parsed as every reader takes it. */
function parsedOf(file: string, value: unknown): { screen?: Screen; problems: Problem[] } {
  const parsed = parseFile(file, screenFileSchema, value)

  if (parsed.value === undefined) {
    return { problems: parsed.problems }
  }

  const misnamed = nameProblems(file, parsed.value)

  return misnamed.length > 0 ? { problems: misnamed } : { screen: parsed.value, problems: [] }
}

/** Whether the frame as read writes the codes of its toast anchor itself. */
const writesToastCodes = (read: readonly unknown[], toast: string): boolean =>
  read.some(
    (screen) =>
      isRecord(screen) &&
      screen['frame'] === true &&
      recordOf(recordOf(screen['anchors'])[toast])['codes'] !== undefined,
  )

function readScreenFiles(
  root: string,
  failureOf: FailureOf,
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
  const lookups: Lookups = { codesOf: codesOfRead(values), failureOf, toast: toastOfRead(values) }
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

  // Codes the frame writes on its toast anchor are written codes, each with its own vocabulary row.
  const written = toast !== undefined && writesToastCodes(values, toast)

  return { screens, files, problems, toasts: written ? [] : [...derived.values()] }
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
  const { screens, files, problems: screenProblems, toasts } = readScreenFiles(root, failureOf)
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
