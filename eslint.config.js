import { fileURLToPath } from 'node:url'

import base, { importBoundaries } from '@workspace/eslint-config'

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url))

export default [
  ...base,
  importBoundaries({
    modules: [
      {
        // The gateway: one module per mechanism of the platform, entered through its index.ts.
        root: path('./apps/gateway/src'),
        // Modules that predate the rule, imported file by file until their next split gives
        // them an index.ts. An entry leaves when its module gets one; none is ever added.
        flat: ['auth', 'limits', 'sync', 'tenants'],
        // The composition root assembles the modules; it is not one of them.
        outside: ['composition'],
      },
    ],
    // Folders or files that still import inside another folder. An entry leaves at the
    // split that ends its need; none is ever added.
    reachIn: [
      {
        // The contract files load scenarios, and the scenario parser reads YAML and reports
        // problems with the helpers of the contract files: their index would close a cycle.
        folder: path('./packages/ui-contract/src/files'),
        from: path('./packages/ui-contract/src/scenarios'),
      },
      {
        // The sync engine's spec fails the server's accept and load by their statements.
        folder: path('./packages/replica/src/server'),
        from: path('./packages/replica/src/sync/sync-engine.spec.ts'),
      },
    ],
  }),
]
