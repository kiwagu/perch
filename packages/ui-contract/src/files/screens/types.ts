/** The shapes the screen loader assembles, as every reader takes them. */

import type { z } from '@workspace/zod'

import type {
  anchorBindingSchema,
  anchorDefSchema,
  bindingRefSchema,
  bindingSchema,
  effectSchema,
  flowSchema,
  paramValueSchema,
  platformFileSchema,
  platformSchema,
  screenSchema,
  transitionSchema,
} from '../../schemas'
import type { DerivedToast } from '../expand-flow'

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
