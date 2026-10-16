/**
 * The narrow ESLint layer. Biome owns formatting, import order and base lint;
 * this config carries only what Biome cannot check:
 *   - blank lines between statements (@stylistic/padding-line-between-statements),
 *   - hexagonal layer boundaries (eslint-plugin-boundaries),
 *   - type-aware promise rules and the must-use-Result rule (typescript-eslint),
 *   - immutability and no-throw discipline in domain and application code
 *     (eslint-plugin-functional).
 * No rule here may format tokens.
 */

import stylistic from '@stylistic/eslint-plugin'
import boundaries from 'eslint-plugin-boundaries'
import functional from 'eslint-plugin-functional'
import tseslint from 'typescript-eslint'

import { mustUseResult } from './rules/must-use-result.js'

const workspace = { rules: { 'must-use-result': mustUseResult } }

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

export const ignores = {
  ignores: [
    '**/dist/**',
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
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.config.ts'],
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
      'workspace/must-use-result': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
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
    files: ['**/domain/**/*.{ts,tsx}', '**/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictModules(
        [...UI_MODULES, ...DRIVER_MODULES],
        'Domain and application code reach UI frameworks and drivers only through ports.',
      ),
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
    files: ['**/domain/**/*.{ts,tsx}', '**/application/**/*.{ts,tsx}'],
    ignores: ['**/*.spec.{ts,tsx}'],
    plugins: { functional },
    rules: {
      'functional/no-let': ['error', { allowInForLoopInit: true }],
      'functional/immutable-data': 'error',
      'functional/prefer-readonly-type': 'error',
      'no-restricted-syntax': ['error', throwOnlyExceptions],
    },
  },
]

export default base
