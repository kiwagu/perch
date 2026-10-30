import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withoutSourceMaps } from './wasm-source-maps'

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

/** A custom section named `name` holding `data`. */
function custom(name: string, data: string): number[] {
  const contents = [
    name.length,
    ...new TextEncoder().encode(name),
    ...new TextEncoder().encode(data),
  ]

  return [0x00, contents.length, ...contents]
}

/** A type section with one function type taking and giving nothing. */
const TYPES = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00]

const has = (module: Uint8Array, text: string): boolean =>
  Buffer.from(module).includes(Buffer.from(text))

describe('withoutSourceMaps', () => {
  it('drops the source-map section and keeps every other section byte for byte', () => {
    const named = custom('name', '')
    const module = new Uint8Array([
      ...HEADER,
      ...custom('sourceMappingURL', 'https://cdn.example.test/module.wasm.map'),
      ...TYPES,
      ...named,
    ])
    const stripped = withoutSourceMaps(module)

    expect([...stripped]).toEqual([...HEADER, ...TYPES, ...named])
    expect(WebAssembly.validate(stripped)).toBe(true)
  })

  it("strips loro-crdt's module of its pointer to a CDN, which stays a valid module", () => {
    // The web app reaches loro-crdt through the replica package.
    const replica = join(import.meta.dirname, '../../../packages/replica/package.json')
    const path = createRequire(replica).resolve('loro-crdt/bundler/loro_wasm_bg.wasm')
    const module = new Uint8Array(readFileSync(path))
    const stripped = withoutSourceMaps(module)

    expect(has(module, 'sourceMappingURL')).toBe(true)
    expect(has(stripped, 'sourceMappingURL')).toBe(false)
    expect(has(stripped, 'unpkg.com')).toBe(false)
    expect(WebAssembly.validate(stripped)).toBe(true)
  })

  it('refuses a file that is not a WASM module, or a section that runs past its end', () => {
    expect(() => withoutSourceMaps(new TextEncoder().encode('<!doctype html>'))).toThrow(
      'not a WASM module',
    )
    expect(() => withoutSourceMaps(new Uint8Array([...HEADER, 0x01, 0x20, 0x00]))).toThrow(
      'runs past the end',
    )
  })

  it('keeps a section whose name only looks like the source map, a byte-order mark before it', () => {
    const lookalike = custom('\uFEFFsourceMappingURL', 'https://cdn.example.test/kept.map')
    const module = new Uint8Array([...HEADER, ...lookalike])

    expect([...withoutSourceMaps(module)]).toEqual([...HEADER, ...lookalike])
  })

  it('reads sizes over several bytes, padded ones too', () => {
    // A type section whose size, 4, is written in five bytes.
    const padded = [0x01, 0x84, 0x80, 0x80, 0x80, 0x00, 0x01, 0x60, 0x00, 0x00]
    const module = new Uint8Array([...HEADER, ...padded])

    expect([...withoutSourceMaps(module)]).toEqual([...HEADER, ...padded])
    expect(WebAssembly.validate(withoutSourceMaps(module))).toBe(true)
  })

  it('refuses an unfinished number, one past 32 bits, and a name past its section', () => {
    expect(() => withoutSourceMaps(new Uint8Array([...HEADER, 0x00, 0x80]))).toThrow(
      'no complete number',
    )
    expect(() =>
      withoutSourceMaps(new Uint8Array([...HEADER, 0x00, 0xff, 0xff, 0xff, 0xff, 0x7f])),
    ).toThrow('does not fit in 32 bits')
    // A custom section of 3 bytes whose name claims 16.
    expect(() =>
      withoutSourceMaps(new Uint8Array([...HEADER, 0x00, 0x03, 0x10, 0x73, 0x6f, 0x01, 0x04])),
    ).toThrow('runs past its section')
  })
})
