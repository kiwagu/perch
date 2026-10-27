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
  {
    // The web app's views keep every leave and every field under the frame's guard of unsaved
    // input: a screen moves through its machine (useScreenMachine runs a flow's navigation) or the
    // unguarded move the platform offers for a leave nobody started here (useLeaveNow), and a form
    // is the kit's, whose saved submit clears its fields' unsaved input. The shared config's raw
    // fields are listed again, since this block's list replaces its list for these files.
    files: ['apps/web/src/features/**/presentation/**/*.{ts,tsx}'],
    ignores: ['**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-router',
              importNames: ['useNavigate'],
              message:
                "Move through useScreenMachine (a flow's navigation) or useLeaveNow (a leave nobody started here): both know the frame's guard.",
            },
          ],
        },
      ],
      'react/forbid-elements': [
        'error',
        {
          forbid: [
            { element: 'input', message: "Use the kit's Input: it tracks unsaved input." },
            { element: 'textarea', message: "Use the kit's Textarea: it tracks unsaved input." },
            { element: 'select', message: "Use the kit's Select: it tracks unsaved input." },
            {
              element: 'form',
              message: "Use the kit's Form: a saved submit clears its fields' unsaved input.",
            },
          ],
        },
      ],
    },
  },
]
