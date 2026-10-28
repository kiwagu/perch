/**
 * Rule 14: the frame's confirmation, which asks before every destructive action (the loader
 * derives the controls that ask, `files/derive/questions.ts`). An anchor of kind `confirmation`
 * is declared by the frame alone, once, reserved, with both answers (confirm-button lets the
 * action that opened it run, cancel-button stays) and no action of its own.
 */

import type { Problem } from '../files'

import { ANSWERS, bindingRefsOf, type Contract, declaredAnchors, locate } from './contract'

export function confirmationsProblems({ screens }: Contract): Problem[] {
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
          ...bindingRefsOf(def).flatMap(({ ref }) =>
            'action' in ref
              ? [
                  inScreens(
                    at,
                    `"${anchor}" runs "${ref.action}"; its confirm-button only lets the action that opened it run`,
                  ),
                ]
              : [],
          ),
        ]),
  ])
}
