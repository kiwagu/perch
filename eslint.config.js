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
    // Folders that still import inside another one, as its index would close an import
    // cycle. An entry leaves at the split that ends the cycle; none is ever added.
    reachIn: [
      {
        // The contract files load scenarios, and the scenario parser reads YAML and reports
        // problems with the helpers of the contract files.
        folder: path('./packages/ui-contract/src/files'),
        from: path('./packages/ui-contract/src/scenarios'),
      },
    ],
  }),
]
