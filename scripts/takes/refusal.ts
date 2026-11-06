/**
 * What the take check says of a commit on an area branch: nothing when it changes no business
 * file and names neither the `contract` scope nor a source, or is a take or a business commit
 * written on the branch in its form; otherwise the refusal, ending with the form.
 */

import { isBusinessFile } from '@workspace/ui-contract'

import {
  CARD,
  FORM,
  LAYER,
  listed,
  TAKEN,
  TAKEN_FORM,
  TRUNK,
  WRITTEN,
  WRITTEN_FORM,
} from './form.ts'
import type { Message } from './message.ts'
import { takenProblems } from './trunk.ts'

const SUBJECT = /^[a-z]+\(contract\): \S/

const SCOPES = /^[A-Za-z]*\(([^)]*)\)/

/** Whether the subject names the `contract` scope, in whatever form. */
function claimsScope(subject: string): boolean {
  const scopes = SCOPES.exec(subject)?.[1] ?? ''

  return scopes.split(',').some((scope) => scope.trim().toLowerCase() === 'contract')
}

/** Whether `key` is a source trailer's, in whatever case. */
function isSource(key: string): boolean {
  return [TAKEN, WRITTEN].some((source) => source.toLowerCase() === key.toLowerCase())
}

/** What is wrong with a commit that names the contract scope or a source, or nothing. */
function contractProblems(message: Message, files: readonly string[]): readonly string[] {
  const problems: string[] = []
  const outside = files.filter((file) => !isBusinessFile(file))
  const sources = message.trailers.filter(({ key }) => isSource(key))
  const [source] = sources

  if (!SUBJECT.test(message.subject)) {
    problems.push(
      `its subject is "<type>(contract): <the card's goal>": "${message.subject}" is not.`,
    )
  }

  if (outside.length > 0) {
    problems.push(
      `it stages files outside the business layer (${LAYER}), which go in a commit of their own under another scope (feat(web), docs(coverage), ...):\n${listed(outside)}`,
    )
  }

  if (source === undefined) {
    problems.push(
      `it names its source in no trailer: "${TAKEN_FORM}" or "${WRITTEN_FORM}", as the message's last paragraph, after an empty line.`,
    )
  } else if (sources.length > 1) {
    problems.push(
      `it names its source in one trailer, and it has ${sources.length}: ${sources.map(({ key }) => `${key}:`).join(', ')}.`,
    )
  } else if (source.key !== TAKEN && source.key !== WRITTEN) {
    problems.push(
      `its trailer's key is written "${TAKEN}:" or "${WRITTEN}:", in that case, not "${source.key}:".`,
    )
  } else if (source.key === TAKEN) {
    problems.push(...takenProblems(source.value, files))
  } else if (!source.value.split(/\s+/).every((card) => CARD.test(card))) {
    problems.push(
      `its trailer reads "${WRITTEN_FORM}", naming each card: "${WRITTEN}: ${source.value}" is not.`,
    )
  }

  return problems
}

/** The refusal of a commit on `branch` that stages `files` with `message`, or undefined. */
export function takeRefusal(
  branch: string,
  message: Message,
  files: readonly string[],
): string | undefined {
  if (claimsScope(message.subject) || message.trailers.some(({ key }) => isSource(key))) {
    const problems = contractProblems(message, files)

    return problems.length === 0
      ? undefined
      : [
          `contract take: on ${branch}, a commit that names the contract scope or a source is a take of the business layer from ${TRUNK}, and this one is not in its form:`,
          ...problems.map((problem) => `- ${problem}`),
          FORM,
        ].join('\n')
  }

  const business = files.filter((file) => isBusinessFile(file))
  const outside = files.filter((file) => !isBusinessFile(file))

  if (business.length === 0) {
    return undefined
  }

  return [
    `contract take: on ${branch}, the UI contract's business layer (${LAYER}) comes from ${TRUNK} as a take, and this commit changes it:`,
    listed(business),
    ...(outside.length > 0
      ? ['and mixes it with other files, which go in a commit of their own:', listed(outside)]
      : []),
    FORM,
  ].join('\n')
}
