/**
 * The baseline a checkout without one starts from: every measured file at or above the red
 * threshold with its size as committed where HEAD left `main` (their merge base), never as it
 * is on disk. A checkout whose branch grew a file before the checkout's first run would
 * otherwise adopt that growth, and its commits would pass until the squash into main refused
 * them; read from main, every checkout enforces the same ceiling from its first commit.
 */

import { type ExecFileSyncOptionsWithBufferEncoding, execFileSync } from 'node:child_process'

import { BASELINE_PATH, type Baseline } from './baseline-file.ts'
import { countLines, isMeasured } from './measured-files.ts'

export const MAIN = 'main'

export interface MainBaseline {
  /** The commit the sizes were read at. */
  readonly base: string
  readonly baseline: Baseline
}

interface Blob {
  readonly path: string
  readonly id: string
}

function git(args: readonly string[], input?: string): Buffer {
  const options: ExecFileSyncOptionsWithBufferEncoding = {
    maxBuffer: 256 * 1024 * 1024,
    stdio: 'pipe',
  }

  return execFileSync('git', [...args], input === undefined ? options : { ...options, input })
}

/** Where HEAD left main; exits naming both when git finds no such commit. */
function mergeBase(): string {
  try {
    return git(['merge-base', 'HEAD', MAIN]).toString('utf8').trim()
  } catch {
    console.error(
      `${BASELINE_PATH} is missing and HEAD has no merge base with \`${MAIN}\`: a checkout adopts the sizes committed there`,
    )
    process.exit(2)
  }
}

/** The measured files of `commit` with their blob ids. */
function measuredBlobs(commit: string, includeTests: boolean): Blob[] {
  return git(['ls-tree', '-r', '-z', commit])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      const tab = entry.indexOf('\t')
      const [, type, id = ''] = entry.slice(0, tab).split(' ')
      const path = entry.slice(tab + 1)

      return type === 'blob' && isMeasured(path, includeTests) ? [{ path, id }] : []
    })
}

/** The line count of each blob, in order, read by one `git cat-file --batch`. */
function lineCounts(ids: readonly string[]): number[] {
  if (ids.length === 0) {
    return []
  }

  const output = git(['cat-file', '--batch'], `${ids.join('\n')}\n`)
  const counts: number[] = []
  let offset = 0

  for (const _ of ids) {
    const headerEnd = output.indexOf(0x0a, offset)
    const size = Number(output.toString('utf8', offset, headerEnd).split(' ')[2])
    const start = headerEnd + 1

    counts.push(countLines(output.toString('utf8', start, start + size)))
    offset = start + size + 1
  }

  return counts
}

export function mainBaseline(red: number, includeTests: boolean): MainBaseline {
  const base = mergeBase()
  const blobs = measuredBlobs(base, includeTests)
  const counts = lineCounts(blobs.map((blob) => blob.id))
  const baseline: Record<string, number> = {}

  blobs.forEach((blob, index) => {
    const lines = counts[index] ?? 0

    if (lines >= red) {
      baseline[blob.path] = lines
    }
  })

  return { base, baseline }
}
