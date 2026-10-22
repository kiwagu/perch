/** Reads `contract/screens.json`: JSON, then the Zod schema of the file. */

import type { z } from '@workspace/zod'

import {
  type anchorBindingSchema,
  type anchorDefSchema,
  type bindingRefSchema,
  type bindingSchema,
  type paramValueSchema,
  type platformSchema,
  type screenSchema,
  screensFileSchema,
} from '../schemas'

import { parseFile } from './parse-file'
import { SCREENS_FILE } from './paths'
import type { Problem } from './problems'
import { readJson } from './read-json'

export type ScreensFile = z.infer<typeof screensFileSchema>
export type Screen = z.infer<typeof screenSchema>
export type AnchorDef = z.infer<typeof anchorDefSchema>
export type Binding = z.infer<typeof bindingSchema>
export type BindingRef = z.infer<typeof bindingRefSchema>
export type AnchorBinding = z.infer<typeof anchorBindingSchema>
export type ParamValue = z.infer<typeof paramValueSchema>
export type Platform = z.infer<typeof platformSchema>

export function loadScreens(root: string): { screens?: ScreensFile; problems: Problem[] } {
  const read = readJson(root, SCREENS_FILE)

  if (read.json === undefined) {
    return { problems: read.problems }
  }

  const parsed = parseFile(SCREENS_FILE, screensFileSchema, read.json)

  return parsed.value === undefined
    ? { problems: parsed.problems }
    : { screens: parsed.value, problems: [] }
}
