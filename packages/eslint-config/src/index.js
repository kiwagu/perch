/**
 * The narrow ESLint layer. Biome owns formatting, import order and base lint;
 * this config carries only what Biome cannot check:
 *   - blank lines between statements (@stylistic/padding-line-between-statements),
 *   - hexagonal layer boundaries (eslint-plugin-boundaries),
 *   - type-aware promise rules and the must-use-Result rule (typescript-eslint),
 *   - immutability and no-throw discipline in domain and application code
 *     (eslint-plugin-functional),
 *   - one class per file everywhere, and one exported function or class per file in
 *     domain and application code (core max-classes-per-file, workspace/one-unit-per-file),
 *   - a folder with an index.ts, or a module, entered only through its index
 *     (workspace/import-through-index).
 * No rule here may format tokens.
 */

import stylistic from '@stylistic/eslint-plugin'
import boundaries from 'eslint-plugin-boundaries'
import functional from 'eslint-plugin-functional'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'

import { importThroughIndex } from './rules/import-through-index.js'
import { mustUseResult } from './rules/must-use-result.js'
import { oneUnitPerFile } from './rules/one-unit-per-file.js'

const workspace = {
  rules: {
    'import-through-index': importThroughIndex,
    'must-use-result': mustUseResult,
    'one-unit-per-file': oneUnitPerFile,
  },
}

const paddingRules = [
  'error',
  { blankLine: 'always', prev: 'import', next: '*' },
  { blankLine: 'any', prev: 'import', next: 'import' },
  { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
  { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
  { blankLine: 'always', prev: '*', next: 'return' },
  { blankLine: 'always', prev: '*', next: ['function', 'class', 'export'] },
  { blankLine: 'always', prev: ['function', 'class'], next: '*' },
  // Biome sorts consecutive exports into one block, the same way it treats imports.
  { blankLine: 'any', prev: 'export', next: 'export' },
]

/** Layers of a feature or package, recognised by folder name. */
const elements = [
  { type: 'domain', pattern: '**/domain' },
  { type: 'application', pattern: '**/application' },
  { type: 'presentation', pattern: '**/presentation' },
  { type: 'adapters', pattern: '**/adapters' },
]

const UI_MODULES = [
  'react',
  'react-dom',
  'react/*',
  '@xstate/react',
  '@workspace/ui',
  '@workspace/ui/*',
]
const TESTS = '**/*.spec.{ts,tsx}'
const TYPED = { files: ['**/*.{ts,tsx}'], ignores: ['**/*.config.ts'] }

const RAW_DRIVERS = ['surrealdb', '@surrealdb/*', 'loro-crdt']
const DATA_PACKAGES = [
  '@workspace/data',
  '@workspace/data/*',
  '@workspace/replica',
  '@workspace/replica/*',
]
const DRIVER_MODULES = [
  'surrealdb',
  '@surrealdb/*',
  'loro-crdt',
  '@workspace/data',
  '@workspace/data/*',
  '@workspace/replica',
  '@workspace/replica/*',
]

const dependencyPolicies = [
  {
    from: { element: { type: 'domain' } },
    disallow: { to: { element: { types: ['application', 'presentation', 'adapters'] } } },
  },
  {
    from: { element: { type: 'application' } },
    disallow: { to: { element: { types: ['presentation', 'adapters'] } } },
  },
  {
    from: { element: { type: 'presentation' } },
    disallow: { to: { element: { type: 'adapters' } } },
  },
]

const restrictModules = (group, message) => ['error', { patterns: [{ group, message }] }]

/** Expected outcomes are values; only programming invariants may throw. */
const throwOnlyExceptions = {
  selector:
    "ThrowStatement:not([argument.type='NewExpression'][argument.callee.name=/Exception$/])",
  message:
    'Return a Result for expected outcomes; throw only an ExceptionBase subclass (named *Exception) for a broken invariant.',
}

/** A t() key must stay greppable: a literal, a template without expressions, or a choice of two literals. */
const literalTranslationKeys = {
  selector:
    "CallExpression[callee.name='t'][arguments.length>0]:not([arguments.0.type='Literal']):not([arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0]):not([arguments.0.type='ConditionalExpression'][arguments.0.consequent.type='Literal'][arguments.0.alternate.type='Literal'])",
  message:
    'Pass t() a literal key, or a choice between two literal keys, so the key stays greppable and checkable.',
}

export const ignores = {
  ignores: [
    '**/dist/**',
    '**/dist-dev/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/__fixtures__/**',
    '**/*.gen.ts',
    '**/*.surql.d.ts',
  ],
}

export const base = [
  ignores,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/padding-line-between-statements': paddingRules,
    },
  },
  {
    ...TYPED,
    languageOptions: {
      parserOptions: { projectService: true },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      workspace,
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // The compiler accepts a deprecated API silently; its replacement is named in the
      // deprecation note.
      '@typescript-eslint/no-deprecated': 'error',
      // No `any`: Biome refuses a written one; these stop one that leaks in from an
      // untyped API (JSON.parse, a driver result) from spreading through typed code.
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      'workspace/must-use-result': 'error',
      'workspace/import-through-index': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    // Tests compose real adapters and generated models, as the composition root does.
    ignores: [TESTS],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/include': ['**/*.{ts,tsx}'],
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] },
      },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'allow', policies: dependencyPolicies }],
    },
  },
  {
    files: ['**/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictModules(
        [...UI_MODULES, ...DRIVER_MODULES],
        'Domain code is free of IO: no UI frameworks, drivers or data packages.',
      ),
    },
  },
  {
    files: ['**/application/**/*.{ts,tsx}'],
    ignores: [TESTS],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...UI_MODULES, ...RAW_DRIVERS],
              message: 'Application code reaches UI frameworks and drivers only through ports.',
            },
            {
              group: DATA_PACKAGES,
              allowTypeImports: true,
              message:
                'Application code uses the port types of the data packages; adapters are wired in the composition root.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/presentation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictModules(
        DRIVER_MODULES,
        'Presentation reads data through services and ports, never through drivers.',
      ),
    },
  },
  {
    files: ['**/presentation/**/*.{ts,tsx}'],
    ignores: [TESTS],
    plugins: { react },
    settings: { react: { version: '19.3' } },
    rules: {
      'react/jsx-no-literals': 'error',
      'no-restricted-syntax': ['error', literalTranslationKeys],
    },
  },
  {
    files: ['**/domain/**/*.{ts,tsx}', '**/application/**/*.{ts,tsx}'],
    ignores: [TESTS],
    plugins: { functional },
    rules: {
      'functional/no-let': ['error', { allowInForLoopInit: true }],
      'functional/immutable-data': 'error',
      'functional/prefer-readonly-type': 'error',
      'no-restricted-syntax': ['error', throwOnlyExceptions],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    ignores: [TESTS],
    rules: {
      // A file is named after the one class it holds; class expressions count too.
      'max-classes-per-file': ['error', { max: 1 }],
    },
  },
  {
    files: ['**/domain/**/*.{ts,tsx}', '**/application/**/*.{ts,tsx}'],
    ignores: [TESTS],
    plugins: { workspace },
    rules: {
      // A business function or a class per file; small related helpers stay private to it.
      'workspace/one-unit-per-file': 'error',
    },
  },
]

/**
 * The import-through-index rule with the repository's own layout, by absolute paths:
 * `modules` lists folders of modules (`{ root, flat, outside }`: the modules that predate the
 * rule and the folders that are not modules), `reachIn` the folders or files that may still
 * import inside another folder (`{ folder, from }`). See the rule for the details.
 */
export function importBoundaries({ modules = [], reachIn = [] }) {
  return {
    ...TYPED,
    plugins: { workspace },
    rules: { 'workspace/import-through-index': ['error', { modules, reachIn }] },
  }
}

export default base
