import { describe, expect, it } from 'vitest'

import { isBusinessFile } from './paths'

describe('the files of the business layer', () => {
  it('are the domain files, the vocabulary and the scenarios', () => {
    for (const path of [
      'contract/domain/model.schema.json',
      'contract/domain/platform.yaml',
      'contract/domain/screens/__root.yaml',
      'contract/domain/screens/org/$org.yaml',
      'contract/domain/activities/session.yaml',
      'contract/vocabulary.md',
      'tests/e2e/scenarios/user/base/sign-up.md',
    ]) {
      expect(isBusinessFile(path), path).toBe(true)
    }
  })

  it('leave out the engine, its generated files and docs, the code and its tests', () => {
    for (const path of [
      'contract/README.md',
      'contract/COVERAGE.md',
      'contract/schemas/screen.schema.json',
      'packages/ui-contract/src/files/paths.ts',
      '.cursor/rules/ui-contract.mdc',
      'apps/web/src/main.tsx',
      'tests/e2e/src/user/base/sign-up.e2e.spec.ts',
    ]) {
      expect(isBusinessFile(path), path).toBe(false)
    }
  })

  it('take a folder by its whole name, never a file whose name only starts with it', () => {
    for (const path of [
      'contract/domain-old/platform.yaml',
      'contract/vocabulary.md.orig',
      'tests/e2e/scenarios-old/user/base/sign-up.md',
    ]) {
      expect(isBusinessFile(path), path).toBe(false)
    }
  })
})
