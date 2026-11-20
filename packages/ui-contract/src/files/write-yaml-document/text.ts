/** The YAML text of a value written anew, and the lines of the text it goes into. */

import { Document, isNode, type Node, type Scalar, YAMLSeq } from 'yaml'

/** `value` written as a document of its own, as `migrate` writes YAML, without its last newline. */
export const yamlOf = (value: unknown): string =>
  new Document(value).toString({ lineWidth: 0 }).replace(/\n$/, '')

/** A scalar as an item of a flow collection writes it, quoted where a comma or a bracket needs. */
export function flowYamlOf(scalar: Scalar): string {
  const holder = new YAMLSeq()

  holder.flow = true
  holder.items.push(scalar)

  return yamlOf(holder).replace(/^\[ /, '').replace(/ \]$/, '')
}

/** `value` without the comment and the blank line before it, when it is a node. */
export function withoutLead(value: unknown): unknown {
  if (!isNode(value)) {
    return value
  }

  const copy = value.clone() as Node

  copy.commentBefore = null
  copy.spaceBefore = false

  return copy
}

/** The offset where the line holding `at` starts. */
export const lineStart = (source: string, at: number): number =>
  source.lastIndexOf('\n', at - 1) + 1

/** The offset after the line that a node ending at `at` ends on. */
export function lineEnd(source: string, at: number): number {
  if (at > 0 && source[at - 1] === '\n') {
    return at
  }

  const next = source.indexOf('\n', at)

  return next === -1 ? source.length : next + 1
}

/** `text` with each line after the first moved right by `column`; an empty line stays empty. */
export const indented = (text: string, column: number): string =>
  text
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : `${' '.repeat(column)}${line}`))
    .join('\n')
