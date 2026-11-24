import { describe, expect, it } from 'vitest'
import { type Document, isMap, isSeq, type YAMLMap, type YAMLSeq } from 'yaml'

import { parseYamlDocument } from '../read-yaml-document'

import { writeYamlDocument } from './write'

/** A text YAML would write otherwise: extra spaces, comments, a flow map, quotes, a blank line. */
const SOURCE = [
  '# yaml-language-server: $schema=../schemas/platform.schema.json',
  'version:   1 # the format',
  "quoted: 'single'",
  'anchors:',
  '  a:',
  '    kind:    page',
  '  # about b',
  '  b: { k:  v, j: "x" }',
  '',
  '  c:   1',
  'list:',
  '  -   x',
  '  - y:   1',
  '    z: 2',
  'last:   end',
  '',
].join('\n')

/** The map at `key` of the root of `document`. */
function mapAt(document: Document, key: string): YAMLMap {
  const found = document.get(key, true)

  if (!isMap(found)) {
    throw new Error(`no map at ${key}`)
  }

  return found
}

function seqAt(document: Document, key: string): YAMLSeq {
  const found = document.get(key, true)

  if (!isSeq(found)) {
    throw new Error(`no sequence at ${key}`)
  }

  return found
}

/** The source as `edit` leaves its document, written into the source. */
function written(edit: (document: Document) => void): string {
  const document = parseYamlDocument(SOURCE)

  edit(document)

  return writeYamlDocument(SOURCE, document)
}

describe('writeYamlDocument', () => {
  it('writes the text as it was when nothing changed, though YAML would write it otherwise', () => {
    expect(parseYamlDocument(SOURCE).toString({ lineWidth: 0 })).not.toBe(SOURCE)
    expect(written(() => undefined)).toBe(SOURCE)
  })
  it('writes a changed scalar in place, its comment and every other byte kept', () => {
    expect(written((document) => document.set('version', 2))).toBe(
      SOURCE.replace('version:   1 # the format', 'version:   2 # the format'),
    )
  })
  it('keeps the quotes of a quoted scalar it changes', () => {
    expect(written((document) => document.set('quoted', 'other'))).toBe(
      SOURCE.replace("quoted: 'single'", "quoted: 'other'"),
    )
  })
  it('quotes a value as a flow collection needs, the rest of the collection as written', () => {
    expect(written((document) => document.setIn(['anchors', 'b', 'k'], 'a, b'))).toBe(
      SOURCE.replace('{ k:  v, j: "x" }', '{ k:  "a, b", j: "x" }'),
    )
  })
  it('cuts a removed pair with its lines', () => {
    expect(written((document) => mapAt(document, 'anchors').delete('a'))).toBe(
      SOURCE.replace('  a:\n    kind:    page\n', ''),
    )
  })
  it('inserts an added pair after the pair before it, at the column of its map', () => {
    expect(written((document) => mapAt(document, 'anchors').set('d', { kind: 'list' }))).toBe(
      SOURCE.replace('  c:   1\n', '  c:   1\n  d:\n    kind: list\n'),
    )
  })
  it('cuts a removed item and inserts an added one after the item before it', () => {
    const text = written((document) => {
      seqAt(document, 'list').delete(0)
      seqAt(document, 'list').add('w')
    })

    expect(text).toBe(SOURCE.replace('  -   x\n', '').replace('    z: 2\n', '    z: 2\n  - w\n'))
  })
  it('adds a pair to a map that is an item after its first pair, never before it', () => {
    const text = written((document) => {
      const item = seqAt(document, 'list').items[1]

      if (isMap(item)) {
        item.set('w', 3)
      }
    })

    expect(text).toBe(SOURCE.replace('    z: 2\n', '    z: 2\n    w: 3\n'))
  })
  it('writes a pair anew from its key when its value changes shape, its comment kept once', () => {
    expect(written((document) => mapAt(document, 'anchors').set('b', ['p', 'q']))).toBe(
      SOURCE.replace('  b: { k:  v, j: "x" }\n', '  b:\n    - p\n    - q\n'),
    )
  })
  it('writes a flow collection whose items changed as a whole, and nothing around it', () => {
    const text = written((document) => {
      const flow = mapAt(document, 'anchors').get('b', true)

      if (isMap(flow)) {
        flow.delete('j')
      }
    })

    expect(text).toBe(SOURCE.replace('{ k:  v, j: "x" }', '{ k: v }'))
  })
  it('writes the whole text when its root changes shape', () => {
    const document = parseYamlDocument(SOURCE)
    const root = document.contents

    if (isMap(root)) {
      root.items.reverse()
    }

    expect(writeYamlDocument(SOURCE, document)).toBe(document.toString({ lineWidth: 0 }))
  })
})
