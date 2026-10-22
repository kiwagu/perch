/**
 * The routes view as `ui-contract routes` prints it: four sections, each under its heading
 * (the table's is its header row; the example links' second line says why every default
 * shows), one line per route, in columns two spaces apart, `-` for an empty field. The tree
 * indents a route two spaces per level under `__root`, named with the frame's screen.
 */

import type { RouteNode } from './tree'
import type { RouteRow, RoutesView } from './view'

const EXAMPLES_HEADING = [
  'example links (parameters from examples, search from defaults)',
  "(every search key at its default on purpose; the app's own links leave a default out, the same state)",
]

const GAP = 2

const listed = (names: readonly string[]): string => (names.length === 0 ? '-' : names.join(', '))

/** Rows of cells in columns, each but the last padded to its widest cell and the gap. */
function columns(rows: readonly (readonly string[])[]): string[] {
  const widths = (rows[0] ?? []).map((_, index) =>
    Math.max(...rows.map((row) => (row[index] ?? '').length)),
  )

  return rows.map((row) =>
    row
      .map((cell, index) =>
        index === row.length - 1 ? cell : cell.padEnd((widths[index] ?? 0) + GAP),
      )
      .join(''),
  )
}

const tableOf = (routes: readonly RouteRow[]): string[] =>
  columns([
    ['path', 'screen', 'guard', 'roles', 'history', 'params', 'search', 'file'],
    ...routes.map((route) => [
      route.path,
      route.screen,
      route.guard ?? '-',
      route.roles.join(','),
      route.history,
      route.params.join(',') || '-',
      route.search.join(',') || '-',
      route.file,
    ]),
  ])

const reachedLine = ({ reachedFrom: { links, navigate, activities } }: RouteRow): string =>
  `links: ${listed(links)}   navigate: ${listed(navigate)}   activities: ${listed(activities)}`

/** How deep a node is: the root at 0, a route under it at 1. */
function depthOf(node: RouteNode, tree: readonly RouteNode[]): number {
  const parent = tree.find(({ path }) => path === node.parent)

  return parent === undefined ? 0 : depthOf(parent, tree) + 1
}

/** The root by its name, with the frame's screen when there is one: `__root (app-shell)`. */
const rootLabel = ({ path, screen }: RouteNode): string =>
  screen === null ? path : `${path} (${screen})`

function treeOf(tree: readonly RouteNode[]): string[] {
  const [root, ...routes] = tree

  return [
    ...(root === undefined ? [] : [rootLabel(root)]),
    ...columns(
      routes.map((node) => [
        `${'  '.repeat(depthOf(node, tree))}${node.path}`,
        `-> ${node.screen ?? '-'}  [${node.guard ?? '-'}]`,
      ]),
    ),
  ]
}

export function renderRoutes({ routes, tree }: RoutesView): string {
  return [
    ...tableOf(routes),
    '',
    ...EXAMPLES_HEADING,
    ...columns(routes.map((route) => [route.path, route.example])),
    '',
    'reached from',
    ...columns(routes.map((route) => [route.path, reachedLine(route)])),
    '',
    'tree',
    ...treeOf(tree),
  ].join('\n')
}
