/**
 * Rule 14: the frame's confirmation, which asks before every destructive action (the loader
 * derives the controls that ask, `files/derive/questions.ts`). An anchor of kind `confirmation`
 * is declared by the frame alone, once, reserved, with both answers (confirm-button lets the
 * action that opened it run, cancel-button stays) and no binding; every control that asks,
 * asks it, with a code it carries.
 */

import type { Problem } from '../files'

import { ANSWERS, type Contract, declaredAnchors, locate } from './contract'

export const confirmationsProblems = (contract: Contract): Problem[] => [
  ...declarationProblems(contract),
  ...askingProblems(contract),
]

/** The confirmation itself: on the frame, once, reserved, with both answers and no binding. */
function declarationProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)
  const found = declaredAnchors(screens).filter(({ def }) => def.kind === 'confirmation')
  const [first] = found.filter(({ screen }) => screen.frame === true)

  return found.flatMap(({ anchor, def, screen, at }) => [
    ...(screen.frame === true
      ? []
      : [inScreens(at, 'a confirmation asks for the whole app: only the frame declares it')]),
    ...(first === undefined || first.anchor === anchor
      ? []
      : [inScreens(at, `the frame declares one confirmation; ${first.anchor} is the other`)]),
    ...(screen.frame !== true
      ? []
      : [
          ...(screens.platform.reserved.includes(anchor)
            ? []
            : [inScreens(at, `"${anchor}" is not a reserved anchor of the frame`)]),
          ...ANSWERS.filter((answer) => !(def.derived ?? []).includes(answer)).map((answer) =>
            inScreens(
              at,
              `"${anchor}" renders no ${answer}: going on and staying are its two answers`,
            ),
          ),
          ...(def.binding === undefined
            ? []
            : [
                inScreens(
                  at,
                  `"${anchor}" is bound; it runs nothing of its own, its confirm-button only lets the action that opened it run`,
                ),
              ]),
        ]),
  ])
}

/** Every control that asks, asks the frame's confirmation, with a code it carries. */
function askingProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)
  const anchors = declaredAnchors(screens)
  const dialog = anchors.find(({ def, screen }) => def.kind === 'confirmation' && screen.frame)

  return anchors.flatMap(({ def, at }) => {
    const { asks } = def

    if (asks === undefined) {
      return []
    }

    const where = [...at, 'asks']

    return dialog === undefined || asks.dialog !== dialog.anchor
      ? [
          inScreens(
            where,
            `asks "${asks.dialog}", not the frame's confirmation ${dialog?.anchor ?? '(none declared)'}`,
          ),
        ]
      : (dialog.def.codes ?? []).includes(asks.code)
        ? []
        : [inScreens(where, `asks with "${asks.code}", which ${dialog.anchor} does not carry`)]
  })
}
