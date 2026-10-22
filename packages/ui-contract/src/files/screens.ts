/**
 * Reads the screens and the platform. Each `.yaml` file under `contract/screens`, at any
 * depth and sorted by path, is one screen, named by the path of its first binding
 * (`screenFile`); `contract/platform.yaml` holds the contract version and the platform
 * section. Each file is YAML, then its Zod schema. A missing or empty folder, a file that
 * is not `.yaml`, a file named otherwise than its screen's first binding says and a
 * missing platform file are problems of the file or folder concerned. Once every file
 * loads, they are assembled into one `ScreensFile`, each screen with its file.
 */

import { join } from 'node:path'

import type { z } from '@workspace/zod'

import {
  type anchorBindingSchema,
  type anchorDefSchema,
  type bindingRefSchema,
  type bindingSchema,
  type paramValueSchema,
  platformFileSchema,
  type platformSchema,
  screenFileSchema,
  type screenSchema,
} from '../schemas'

import { filesUnder } from './files-under'
import { parseFile } from './parse-file'
import { PLATFORM_FILE, SCREENS_DIR, screenFile } from './paths'
import type { Problem } from './problems'
import { readYaml } from './read-yaml'

export type Screen = z.infer<typeof screenSchema>
export type AnchorDef = z.infer<typeof anchorDefSchema>
export type Binding = z.infer<typeof bindingSchema>
export type BindingRef = z.infer<typeof bindingRefSchema>
export type AnchorBinding = z.infer<typeof anchorBindingSchema>
export type ParamValue = z.infer<typeof paramValueSchema>
export type Platform = z.infer<typeof platformSchema>
export type PlatformFile = z.infer<typeof platformFileSchema>

/** The screen files and the platform file, assembled: the shape every rule reads. */
export interface ScreensFile {
  version: PlatformFile['version']
  screens: Screen[]
  /** The file of each screen, at the index of the screen: `contract/screens/me.yaml`. */
  files: readonly string[]
  platform: Platform
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

function readScreen(root: string, file: string): { screen?: Screen; problems: Problem[] } {
  const read = readYaml(root, file)

  if (read.problems.length > 0) {
    return { problems: read.problems }
  }

  const parsed = parseFile(file, screenFileSchema, read.value)

  if (parsed.value === undefined) {
    return { problems: parsed.problems }
  }

  const misnamed = nameProblems(file, parsed.value)

  return misnamed.length > 0 ? { problems: misnamed } : { screen: parsed.value, problems: [] }
}

function readScreenFiles(root: string): {
  screens: Screen[]
  files: string[]
  problems: Problem[]
} {
  const screens: Screen[] = []
  const files: string[] = []
  const paths = filesUnder(join(root, SCREENS_DIR))

  if (paths === undefined || paths.length === 0) {
    const message = paths === undefined ? 'cannot read the folder' : 'holds no screen file'

    return { screens, files, problems: [{ file: SCREENS_DIR, message }] }
  }

  const problems: Problem[] = []

  for (const path of paths) {
    const file = `${SCREENS_DIR}/${path}`

    if (path.endsWith(SUFFIX)) {
      const read = readScreen(root, file)

      problems.push(...read.problems)

      if (read.screen !== undefined) {
        screens.push(read.screen)
        files.push(file)
      }
    } else {
      problems.push({
        file,
        message: `not a screen file: the folder holds \`<pathname>${SUFFIX}\` files only`,
      })
    }
  }

  return { screens, files, problems }
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

export function loadScreens(root: string): { screens?: ScreensFile; problems: Problem[] } {
  const { screens, files, problems: screenProblems } = readScreenFiles(root)
  const { platform, problems: platformProblems } = readPlatform(root)
  const problems = [...screenProblems, ...platformProblems]

  if (problems.length > 0 || platform === undefined) {
    return { problems }
  }

  const { version, ...section } = platform

  return { screens: { version, screens, files, platform: section }, problems: [] }
}
