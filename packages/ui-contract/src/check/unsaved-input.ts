/**
 * Rule 12: how a leave that would lose unsaved input asks first. `platform.leaving` comes
 * with `platform.unsavedInput`; its question is a declared, reserved dialog with a code and
 * both answers (confirm-button leaves, cancel-button stays); actions that ask need an action
 * listed under `leaving`.
 */

import type { Problem } from '../files'

import { type Contract, declaredAnchors, locate } from './contract'

const ANSWERS = ['confirm-button', 'cancel-button'] as const

export function unsavedInputProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)
  const { leaving = [], unsavedInput, reserved } = screens.platform

  if (unsavedInput === undefined) {
    return leaving.length > 0
      ? [
          inScreens(
            ['platform', 'leaving'],
            'the leaving actions ask as unsavedInput says, and the platform does not declare it',
          ),
        ]
      : []
  }

  const at = ['platform', 'unsavedInput', 'question'] as const
  const { question } = unsavedInput
  const def = declaredAnchors(screens).find(({ anchor }) => anchor === question)?.def
  const questionProblems =
    def === undefined
      ? [inScreens(at, `"${question}" is not a declared anchor`)]
      : [
          ...(def.kind === 'dialog'
            ? []
            : [inScreens(at, `"${question}" is a ${def.kind}, not a dialog`)]),
          ...(reserved.includes(question)
            ? []
            : [inScreens(at, `"${question}" is not a reserved anchor of the frame`)]),
          ...((def.codes ?? []).length > 0
            ? []
            : [inScreens(at, `"${question}" carries no code: its code names what it asks`)]),
          ...ANSWERS.filter((answer) => !(def.derived ?? []).includes(answer)).map((answer) =>
            inScreens(
              at,
              `"${question}" renders no ${answer}: leaving and staying are its two answers`,
            ),
          ),
        ]

  return [
    ...(unsavedInput.actions === 'question' && leaving.length === 0
      ? [
          inScreens(
            ['platform', 'unsavedInput', 'actions'],
            'the controls ask before an action of leaving, and none is listed',
          ),
        ]
      : []),
    ...questionProblems,
  ]
}
