import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { z } from '@workspace/zod'

import { STAND_FLAGS, STAND_VARS, type StandName } from './names.ts'
import type { Stand } from './settings.ts'

const manifest = z
  .object({
    apps: z.record(
      z.string(),
      z.object({
        run: z.string(),
        depends_on: z
          .array(z.union([z.string(), z.object({ app: z.string() })]))
          .optional()
          .default([]),
      }),
    ),
    profiles: z.record(z.string(), z.array(z.string())),
  })
  .parse(
    Bun.YAML.parse(readFileSync(new URL('../../.mcproc/mcproc.yaml', import.meta.url), 'utf8')),
  )

/** The manifest's gateway app of each stand. */
const GATEWAY_APPS = [
  ['dev', 'gateway'],
  ['e2e', 'gateway-e2e'],
] as const satisfies readonly (readonly [StandName, string])[]

const STAND_KEYS = [
  'surreal',
  'gateway',
  'front',
  'smtp',
  'mailFrom',
  'authSecret',
] as const satisfies readonly (keyof Stand)[]

const runOf = (app: string): string => manifest.apps[app]?.run ?? ''

const dependenciesOf = (app: string): string[] =>
  (manifest.apps[app]?.depends_on ?? []).map((dependency) =>
    typeof dependency === 'string' ? dependency : dependency.app,
  )

/** An app and everything a start of it brings up first. */
const withDependencies = (app: string, seen = new Set<string>()): Set<string> => {
  if (!seen.has(app)) {
    seen.add(app)
    for (const dependency of dependenciesOf(app)) {
      withDependencies(dependency, seen)
    }
  }

  return seen
}

describe("the manifest's gateway apps", () => {
  it.each(GATEWAY_APPS)(
    "start the %s stand's gateway through the shared settings",
    (_stand, app) => {
      expect(runOf(app)).toStartWith('exec bun scripts/stand-gateway/cli.ts ')
      expect(runOf(app)).toEndWith(' -- bun apps/gateway/src/index.ts')
    },
  )

  it.each(GATEWAY_APPS)(
    "pass the %s stand's values from the vars bun run dev reads for it",
    (stand, app) => {
      for (const key of STAND_KEYS) {
        const name = STAND_VARS[stand][key]
        // The From carries spaces, so the shell gets it quoted.
        const value = key === 'mailFrom' ? `'{{ ${name} }}'` : `{{ ${name} }}`

        expect(runOf(app)).toContain(`--${STAND_FLAGS[key]}=${value} `)
      }
    },
  )
})

describe('the services profile', () => {
  it("starts the dev stand's dedicated services", () => {
    expect(manifest.profiles['services']).toEqual(['surrealdb-dev', 'maildev-dev', 'caddy-dev'])
  })

  it('brings up none of the Bun dev scripts bun run dev runs, dependencies included', () => {
    const started = new Set(
      (manifest.profiles['services'] ?? []).flatMap((app) => [...withDependencies(app)]),
    )

    expect([...started].sort()).toEqual(['caddy-dev', 'maildev-dev', 'surrealdb-dev'])
  })
})
