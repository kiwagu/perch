// scenario: contract/base/manifest
import { createValidator, type Manifest, manifestSchema } from '@workspace/ui-contract'
import { baseOf, type RenderedPage } from '@workspace/ui-contract/anchors'
import { z } from '@workspace/zod'

import { appReady, expect, test } from '../../support/fixtures'

/** The rendered anchors the manifest does not declare: neither in `ids` nor derived from one. */
function undeclared(manifest: Manifest, page: RenderedPage): string[] {
  const suffixes = Object.keys(manifest.contract.derivedSuffixes)

  return page.anchors.flatMap(({ anchor, kind }) => {
    const declared = Object.hasOwn(manifest.ids, anchor) ? manifest.ids[anchor] : undefined

    if (declared !== undefined) {
      return declared.kind === kind ? [] : [`${anchor}: kind ${kind}, declared ${declared.kind}`]
    }

    const base = baseOf(anchor, suffixes)
    const entry =
      base !== undefined && Object.hasOwn(manifest.ids, base) ? manifest.ids[base] : undefined
    const suffix = anchor.slice(anchor.lastIndexOf('.') + 1)

    return entry?.derived?.includes(suffix) === true ? [] : [`${anchor}: not in the manifest`]
  })
}

test.describe('Read the UI manifest and the anchors of a running page', { tag: '@smoke' }, () => {
  test('A tool outside the repository reads the manifest the stand serves and matches it with the anchors a running page renders', async ({
    page,
  }) => {
    let served: unknown
    let schema: Record<string, unknown> = {}

    await test.step('1. Fetch the manifest from /ui-manifest/manifest.json on the stand, and its schema from /ui-manifest/manifest.schema.json beside it', async () => {
      const [manifestResponse, schemaResponse] = await Promise.all([
        page.request.get('/ui-manifest/manifest.json'),
        page.request.get('/ui-manifest/manifest.schema.json'),
      ])

      expect(manifestResponse.status()).toBe(200)
      expect(manifestResponse.headers()['cache-control']).toBe('no-store')
      expect(schemaResponse.status()).toBe(200)
      served = await manifestResponse.json()
      schema = z.record(z.string(), z.unknown()).parse(await schemaResponse.json())
    })

    await test.step('2. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
    })

    let rendered: RenderedPage | undefined

    await test.step('3. Call the page helper window.__perch.ui.anchors()', async () => {
      rendered = await page.evaluate(() => window.__perch?.ui.anchors())
    })

    // Expected:
    // - After step 1 the manifest is valid against its schema and names contract version 1
    const validate = createValidator().compile(schema)

    expect(validate(served), JSON.stringify(validate.errors)).toBe(true)

    const manifest = manifestSchema.parse(served)

    expect(manifest.contract.version).toBe(1)
    // - After step 3 every anchor the helper reports is in the manifest's ids with the same kind,
    //   or is derived from one of them with a suffix of that entry's derived
    expect(rendered, 'the build installs window.__perch.ui').toBeDefined()

    const onPage = rendered ?? { url: '', anchors: [] }

    expect(undeclared(manifest, onPage)).toEqual([])
    // - After step 3 the helper reports the page's URL, on [/sign-in], with [app-shell.status] in
    //   [state:ready]
    expect(onPage.url).toBe(page.url())
    expect(new URL(onPage.url).pathname).toBe('/sign-in')
    expect(onPage.anchors).toContainEqual(
      expect.objectContaining({ anchor: 'app-shell.status', state: 'ready' }),
    )
  })
})
