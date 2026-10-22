/**
 * A folder with an `index.ts` is one unit, entered through that index: from outside the
 * folder an import names the folder (`./region-sync`), never a file inside it
 * (`./region-sync/push`); inside the folder its files import each other freely. A
 * workspace's own `src` folder is the package itself, governed by its `exports`.
 *
 * Module roots (option `modules`) hold one module per folder, such as the gateway's
 * mechanisms: there every folder is a unit whether or not it has an index yet, so a new
 * module cannot be reached until it has one. A root's `flat` folders predate the rule and
 * are imported file by file until their next split gives them an index; an entry that has
 * one, or whose folder is gone, fails the run, so the list only shrinks. Its `outside`
 * folders are not modules (the composition root that assembles them), and support folders
 * (`__fixtures__`, dot folders) are none either. A fixture (`*.fixture.*`, or a file under
 * `__fixtures__`) is test data shared by a package's tests, not a unit's internals: anyone may
 * import one.
 *
 * Reach-ins (option `reachIn`): a `{ folder, from }` lets the files under `from` still import
 * files inside `folder`, where going through its index would close an import cycle that only
 * a later split removes. Nobody else gains anything, and an entry whose folder has no index
 * any more, or whose `from` is gone, fails the run, so the list only shrinks.
 *
 * Imports are resolved by TypeScript, so path aliases and workspace packages count as
 * relative imports do; an import TypeScript cannot resolve, or one into an installed
 * library, is not checked. Needs type information (typescript-eslint `projectService`);
 * without it the rule stays silent.
 */

import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

import ts from 'typescript'

const SUPPORT_FOLDER = /^(__|\.)/
const FIXTURE = /(\.fixture\.[cm]?[jt]sx?$)|(^|[\\/])__fixtures__[\\/]/

/** @type {WeakMap<import('typescript').Program, import('typescript').ModuleResolutionCache>} */
const resolutionCaches = new WeakMap()

/** The file an import resolves to inside the repository, or undefined. */
function resolveImport(program, specifier, importer) {
  const options = program.getCompilerOptions()
  let cache = resolutionCaches.get(program)

  if (!cache) {
    cache = ts.createModuleResolutionCache(program.getCurrentDirectory(), (name) => name, options)
    resolutionCaches.set(program, cache)
  }

  const { resolvedModule } = ts.resolveModuleName(specifier, importer, options, ts.sys, cache)

  if (
    !resolvedModule ||
    resolvedModule.isExternalLibraryImport ||
    resolvedModule.resolvedFileName.includes(`${sep}node_modules${sep}`)
  ) {
    return undefined
  }

  return resolvedModule.resolvedFileName
}

const hasIndex = (dir) => existsSync(join(dir, 'index.ts'))
const isWorkspace = (dir) => existsSync(join(dir, 'package.json'))
const isInside = (path, dir) => path === dir || path.startsWith(`${dir}${sep}`)

/** `folder` for a folder entered through its index, `module` for a module without one. */
function unitAt(dir, roots) {
  if (hasIndex(dir)) {
    return basename(dir) === 'src' && isWorkspace(dirname(dir)) ? undefined : 'folder'
  }

  const root = roots.find((entry) => entry.root === dirname(dir))
  const name = basename(dir)

  if (
    !root ||
    SUPPORT_FOLDER.test(name) ||
    root.flat.includes(name) ||
    root.outside.includes(name)
  ) {
    return undefined
  }

  return 'module'
}

/**
 * The outermost unit that holds the target and not the importer, climbing from the
 * target's folder until the importer's side, the workspace root or the filesystem root.
 */
function outermostUnit(target, importerDir, roots) {
  let found

  for (
    let dir = dirname(target);
    !isInside(importerDir, dir) && !isWorkspace(dir) && dir !== dirname(dir);
    dir = dirname(dir)
  ) {
    const kind = unitAt(dir, roots)

    if (kind) {
      found = { dir, kind }
    }
  }

  return found
}

const isFolder = (dir) => existsSync(dir) && statSync(dir).isDirectory()

/** The module roots of the options, each flat entry checked against the tree. */
function rootsOf(options) {
  return (options?.modules ?? []).map(({ root, flat = [], outside = [] }) => {
    for (const name of flat) {
      const dir = join(root, name)

      if (!isFolder(dir)) {
        throw new Error(`workspace/import-through-index: \`${name}\` is not a folder of ${root}`)
      }

      if (hasIndex(dir)) {
        throw new Error(
          `workspace/import-through-index: \`${name}\` has an index.ts now: take it off the flat list of ${root}`,
        )
      }
    }

    return { root, flat, outside }
  })
}

/** The reach-ins of the options, each checked against the tree. */
function reachInsOf(options) {
  return (options?.reachIn ?? []).map(({ folder, from }) => {
    if (!hasIndex(folder)) {
      throw new Error(
        `workspace/import-through-index: ${folder} has no index.ts: take its reach-in off the list`,
      )
    }

    if (!isFolder(from)) {
      throw new Error(
        `workspace/import-through-index: ${from} is gone: take its reach-in into ${folder} off the list`,
      )
    }

    return { folder, from }
  })
}

/** A path as an import would write it from `fromDir`. */
function asSpecifier(fromDir, dir) {
  const path = relative(fromDir, dir).split(sep).join('/')

  return path.startsWith('.') ? path : `./${path}`
}

/** @type {import('eslint').Rule.RuleModule} */
export const importThroughIndex = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Import a folder with an index.ts, or a module, through its index',
    },
    messages: {
      folder:
        '`{{specifier}}` reaches inside `{{unit}}`, a folder entered through its index.ts: import `{{unit}}` instead.',
      module:
        '`{{specifier}}` reaches inside the module `{{unit}}`, which has no index.ts: give it one that re-exports what the rest needs, and import `{{unit}}`.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          modules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                root: { type: 'string' },
                flat: { type: 'array', items: { type: 'string' } },
                outside: { type: 'array', items: { type: 'string' } },
              },
              required: ['root'],
              additionalProperties: false,
            },
          },
          reachIn: {
            type: 'array',
            items: {
              type: 'object',
              properties: { folder: { type: 'string' }, from: { type: 'string' } },
              required: ['folder', 'from'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const program = context.sourceCode.parserServices?.program

    if (!program) {
      return {}
    }

    const roots = rootsOf(context.options[0])
    const reachIns = reachInsOf(context.options[0])
    const importer = context.filename
    const importerDir = dirname(importer)

    function check(source) {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') {
        return
      }

      const target = resolveImport(program, source.value, importer)
      const unit = target && outermostUnit(target, importerDir, roots)

      if (
        !unit ||
        target === join(unit.dir, 'index.ts') ||
        FIXTURE.test(relative(unit.dir, target)) ||
        reachIns.some((entry) => entry.folder === unit.dir && isInside(importerDir, entry.from))
      ) {
        return
      }

      context.report({
        node: source,
        messageId: unit.kind,
        data: { specifier: source.value, unit: asSpecifier(importerDir, unit.dir) },
      })
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    }
  },
}
