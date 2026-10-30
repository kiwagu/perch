/**
 * WASM modules without the `sourceMappingURL` custom section a library may ship them with
 * (loro-crdt's names a source map on a CDN). With DevTools open the browser asks for that map,
 * and the front's policy, which lets a page connect to its own site only, blocks it: a
 * violation in the console of every page that nothing in the app caused. Every other section
 * stays byte for byte. A file that is not a WASM module fails the build: it cannot be one the
 * page loads.
 */

import type { Plugin } from 'vite'

const MAGIC = [0x00, 0x61, 0x73, 0x6d]
const HEADER = 8
const CUSTOM = 0
const SOURCE_MAP = 'sourceMappingURL'

/** An unsigned LEB128 number at `at`, and where the bytes after it start. */
function unsigned(
  module: Uint8Array,
  at: number,
): { readonly value: number; readonly next: number } {
  let value = 0
  let scale = 1

  for (let next = at; next < module.length && next < at + 5; next += 1) {
    const byte = module[next] ?? 0

    value += (byte & 0x7f) * scale
    scale *= 0x80

    if ((byte & 0x80) === 0) {
      return { value, next: next + 1 }
    }
  }

  throw new Error(`a WASM module has no complete number at byte ${at}`)
}

/** Whether the custom section whose contents start at `at` is named `sourceMappingURL`. */
function namesSourceMap(module: Uint8Array, at: number, end: number): boolean {
  const length = unsigned(module, at)

  return (
    length.next + length.value <= end &&
    new TextDecoder().decode(module.subarray(length.next, length.next + length.value)) ===
      SOURCE_MAP
  )
}

/** `module` without its `sourceMappingURL` custom sections. */
export function withoutSourceMaps(module: Uint8Array): Uint8Array {
  if (module.length < HEADER || MAGIC.some((byte, index) => module[index] !== byte)) {
    throw new Error('not a WASM module')
  }

  const kept: Uint8Array[] = [module.subarray(0, HEADER)]

  for (let at = HEADER; at < module.length; ) {
    const id = module[at]
    const size = unsigned(module, at + 1)
    const end = size.next + size.value

    if (end > module.length) {
      throw new Error(`a WASM section at byte ${at} runs past the end of the module`)
    }

    if (!(id === CUSTOM && namesSourceMap(module, size.next, end))) {
      kept.push(module.subarray(at, end))
    }

    at = end
  }

  const stripped = new Uint8Array(kept.reduce((total, part) => total + part.length, 0))

  kept.reduce((offset, part) => {
    stripped.set(part, offset)

    return offset + part.length
  }, 0)

  return stripped
}

/** Strips the source-map section from every `.wasm` the build emits. */
export function stripWasmSourceMaps(): Plugin {
  return {
    name: 'perch:strip-wasm-source-maps',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.wasm')) {
          const source =
            typeof file.source === 'string' ? new TextEncoder().encode(file.source) : file.source

          file.source = withoutSourceMaps(source)
        }
      }
    },
  }
}
