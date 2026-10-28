/**
 * Rule 13: each action of `platform.toasts` is an action of the platform: the toast of its
 * success is derived for every invoke of it, with the code the map gives.
 */

import type { Problem } from '../files'

import { type Contract, has, locate } from './contract'

export function toastsProblems(contract: Contract): Problem[] {
  const { platform } = contract.screens
  const inScreens = locate(contract.screens)

  return Object.keys(platform.toasts ?? {}).flatMap((action) =>
    has(platform.actions, action)
      ? []
      : [inScreens(['platform', 'toasts', action], `"${action}" is no action of platform.actions`)],
  )
}
