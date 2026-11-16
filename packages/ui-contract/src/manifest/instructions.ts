/**
 * The prose of `contract.instructions`: fixed text for an agent that drives the application,
 * read from the engine's rules (`INSTRUCTION_RULES`, which the reference writes too), with the
 * anchors, states and attribute names taken from the vocabulary and the platform section, so
 * nothing the contract declares is typed twice.
 */

import { ANCHOR_ATTRIBUTES, kindOf } from '../anchors'
import type { Platform, Vocabulary } from '../files'
import { INSTRUCTION_RULES } from '../reference'

import type { Instructions } from './manifest.types'

const quoted = (names: readonly string[]): string =>
  names.length === 0 ? 'none' : names.map((name) => `\`${name}\``).join(', ')

const { anchor: ID, state: STATE, code: CODE } = ANCHOR_ATTRIBUTES

function readiness(vocabulary: Vocabulary, platform: Platform, ready: string): string {
  const others = Object.keys(vocabulary.appStates).filter((state) => state !== ready)

  return [
    `Wait for \`[${ID}="${platform.status.anchor}"][${STATE}="${ready}"]\`: the frame and the screen are rendered and a test may act.`,
    `Its other states (${quoted(others)}) are in \`contract.appStates\`: the app is still opening, or it stopped without a screen.`,
    `Then wait for the screen's container to leave \`loading\`: a \`list\`, a \`section\` or a page \`status\` carries one of ${quoted(Object.keys(vocabulary.containerStates))} in \`${STATE}\`.`,
  ].join(' ')
}

function notices(platform: Platform): string {
  const messages = platform.reserved.filter((anchor) => kindOf(anchor) === 'message')

  return [
    `The shell's notice (${quoted(messages)}) shows one notice at a time, the latest, and it outlives the page that raised it.`,
    `Find it by its anchor and its \`${CODE}\` together, right after the action that raises it.`,
  ].join(' ')
}

const { language, session, screenMap, fieldStates, bindings, model, activities, scenarios, gaps } =
  INSTRUCTION_RULES

export function instructionsOf(
  vocabulary: Vocabulary,
  platform: Platform,
  ready: string,
): Instructions {
  return {
    readiness: readiness(vocabulary, platform, ready),
    language: language.text,
    session: session.text,
    screenMap: [screenMap.text, fieldStates.text].join(' '),
    bindings: bindings.text,
    model: model.text,
    notices: notices(platform),
    activities: activities.text,
    scenarios: scenarios.text,
    gaps: gaps.text,
  }
}
