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
const SOURCE_MAP = new TextEncoder().encode('sourceMappingURL')

/**
 * An unsigned 32-bit LEB128 number at `at`, read no further than `end`, and where the bytes
 * after it start: at most five bytes, the fifth carrying no more than the top four bits.
 */
function unsigned(
  module: Uint8Array,
  at: number,
  end: number,
): { readonly value: number; readonly next: number } {
  let value = 0
  let scale = 1

  for (let next = at; next < end && next < at + 5; next += 1) {
    const byte = module[next] ?? 0

    if (next === at + 4 && byte > 0x0f) {
      throw new Error(`a WASM number at byte ${at} does not fit in 32 bits`)
    }

    value += (byte & 0x7f) * scale
    scale *= 0x80

    if ((byte & 0x80) === 0) {
      return { value, next: next + 1 }
    }
  }

  throw new Error(`a WASM module has no complete number at byte ${at}`)
}

/**
 * Whether the custom section whose contents run from `at` to `end` is named `sourceMappingURL`,
 * byte for byte; a name that runs past its section fails the build.
 */
function namesSourceMap(module: Uint8Array, at: number, end: number): boolean {
  const length = unsigned(module, at, end)
  const name = module.subarray(length.next, length.next + length.value)

  if (length.next + length.value > end) {
    throw new Error(`the name of the WASM custom section at byte ${at} runs past its section`)
  }

  return (
    name.length === SOURCE_MAP.length && name.every((byte, index) => byte === SOURCE_MAP[index])
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
    const size = unsigned(module, at + 1, module.length)
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
