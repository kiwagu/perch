/**
 * The rules of a screen's routes: what a binding is, who it serves, the example link built from
 * it and the anchors a test starts from.
 */

import type { ReferenceRule } from '../rule'

const roles: ReferenceRule = {
  id: 'roles',
  title: 'Roles and who a route serves',
  text: [
    "A role is one of the terms file's `roles` (see the rule `terms`). A device holds a set of roles: `guest` when nobody is signed in on it, else `identity` and, beside it, every other role that applies to the signed-in account (its role in the current organisation, a role of the platform, any role a later entry adds: the roles other than the two). `guest` and `identity` are the two roles of which a device holds exactly one; every other role is held beside `identity`, never alone. The contract names the roles; how a device learns the ones beside `identity` is the app's. `GUEST`, `IDENTITY`, `heldRoles` and `admits` of `@workspace/ui-contract/anchors` read them for the app and the checks alike: `heldRoles(signedIn, others)` is the set a device holds (`guest` alone, else `identity` and each of `others` but `guest`), and `admits(roles, held)` says whether a binding's or an anchor's `roles` admit a device that holds one of them.",
    "A binding's `roles` are the roles it serves: the router serves it only to an account that holds at least one of them. An account that holds none gets the screen of the binding at `/$` (the not-found screen) at the same address, as an address no route takes does: the URL and the history entry stay as they are, and nothing on the page, the tab's title included, says there is a route there. The router decides in this order: the binding's `guard` (`authenticated` sends a guest to `/sign-in`, `guest` sends a signed-in account to `/me`), then its `roles`, and only then reads the search, so a search the screen would refuse shows an account its roles miss the not-found screen, never the screen's refusal. A route that must not show itself to a guest leaves its `guard` out and names no `guest`: a guest gets not-found, as any account the roles miss does. The binding at `/$` serves every account: its `roles` name `guest` and `identity`.",
    'The roles of a device change while a screen is open: an account signs in or out, another organisation becomes the current one, a role is granted or taken back. The router decides again when the app learns of it. A screen whose binding no longer serves the account is replaced by the not-found screen and its state is dropped, as when another screen opens (a read of its in flight is dropped with it); a not-found screen at an address whose binding now serves the account is replaced by that screen, which opens as a screen opens (a list with a platform source reads it, see the rule `list-reads`). An app that learns of a change late decides again when it learns; no check sees the interval.',
    "`contract:check` holds who a route serves: no binding's `guard` sends away an account its `roles` name (`authenticated` with `guest`, or `guest` with any other role); an anchor's `roles` are among those its screen's bindings serve (the frame aside); a link to a route whose roles name neither `guest` nor `identity` is shown to no device the route refuses (see the rule `anchor-roles`); and the binding at `/$` names `guest` and `identity`. `contract:diff` lists who each route serves as `<path> guard <guard>` and `<path> serves <role>`, a route added whole with every line.",
  ].join('\n\n'),
  keys: ['screen.bindings.roles', 'screen.bindings.guard', 'screen.anchors.<name>.roles'],
}

const routeBindings: ReferenceRule = {
  id: 'route-bindings',
  title: 'Routes: the bindings of a screen',
  text: [
    "A screen's `bindings` are its routes in the router's format: `path` (static segments, `$param`, `{-$param}` for an optional one, `$` for a splat), `guard` (`guest`: only a visitor; `authenticated`: only a signed-in account), the `roles` it serves, `params` and `search` as flat JSON Schemas, `history` (`push` or `replace`) and `retain`. The frame (`app-shell`, `frame: true`) has no route: it is around every screen.",
    "Every binding `path` is a TanStack Router path in the router's own syntax, `params` are its path parameters and `search` its search parameters, and a route is a state address: the same path with the same search reaches the same state after a reload. The application's router builds and matches every binding (`apps/web/src/platform/routes-router.spec.ts`, a parameter's first example its sample), and the module routes equal the bindings (`routes-contract.spec.ts` beside it); the same folder's `routes-examples.spec.ts` holds every example link and the route tree to the real router. `contract:check` wants every path to parse in the router's syntax, every example of a route parameter to match that parameter, and a `$param` without one to have a value its schema accepts.",
    'A screen is named by the path of its first binding: `/me` is `me.yaml`, `/org/$org` is `org/$org.yaml`, the frame without a binding is `__root.yaml`.',
  ].join('\n\n'),
  keys: [
    'screen.bindings',
    'screen.bindings.path',
    'screen.bindings.history',
    'screen.bindings.retain',
    'screen.frame',
  ],
}

const routeExample: ReferenceRule = {
  id: 'route-example',
  title: 'The example link of a route',
  text: [
    "A parameter of `params` or `search` may carry `examples`: fake values it accepts, of its type (`key: { type: string, examples: [ thg_01hzx9k2 ] }`); `contract:check` holds each one to the parameter's schema. `bun run contract:routes` (`ui-contract routes [--json]`) prints the routes of the screen files in four sections: the table (path, screen, guard, roles, history, params, search, file), one example link per binding, where each route is reached from (the anchors linking to it with `binding.route`, the screens whose flow navigates to it, the activity states at that address) and the tree as the router holds it, `__root (app-shell)` with each route under it, a route under the binding whose path is the longest proper prefix of its own on whole segments.",
    'The example link is built from the binding:',
    [
      "- the path: each `$param` at its parameter's first example, else its `default`, else its first `enum` value, else a value built within its bounds and a `pattern` of a literal prefix and at most one repeated class (`^thg_[a-z0-9]+$` gives `thg_a`), the first of them not empty that the parameter's schema accepts; a parameter none of whose values can be built needs an example, and `contract:check` says so (`a path segment cannot be empty` for a schema that allows only the empty string); a `{-$param}` at its first example, or its segment left out without one; an empty example of a path parameter is a problem; a splat `$` left out with its segment (no parameter can be named `_splat`, so it takes no example); each value through `encodeURIComponent`;",
      '- the search: every key in its declared order at its `default`, else its first `enum` value, else its first example, a key with none left out; written as TanStack Router\'s default `stringifySearch` writes it: a string bare unless it parses as JSON, then quoted (`"123"` is `%22123%22`), a number or a boolean as JSON, the whole form-encoded the way `URLSearchParams` encodes it (a space is `+`).',
    ].join('\n'),
    "So a binding `/things/$thing` whose `thing` has `examples: [ thg_01hzx9k2 ]` and whose `search` has `view` (default `read`) and `page` (default `1`) has the example `/things/thg_01hzx9k2?view=read&page=1`. The example shows every search key with its default on purpose; the app's own links leave out a value equal to its default, and both forms reach the same state. The manifest carries the link as `example` on each binding, and `apps/web/src/platform/routes-examples.spec.ts` holds every example to the real router (the path it builds, the search string it writes, and the route, parameters and search it matches for the link) and the router's route tree to the tree of the screen folder.",
  ].join('\n\n'),
  keys: [
    'screen.bindings.params.properties.<name>.examples',
    'screen.bindings.search.properties.<name>.examples',
  ],
}

const screenEntry: ReferenceRule = {
  id: 'screen-entry',
  title: 'The anchors a test starts from',
  text: [
    "A screen's `entry` lists the anchors a test starts from on the screen. Some of them are alternatives by state, so a test waits for the one its state shows, never for all of them: `user.profile` lists `user.profile.heading`, `user.profile.form` and `user.profile.save-button` once the profile is read (`ready`); until then, and when the account has no profile, `user.profile.status` shows instead (`loading`, `empty`). A screen whose data arrives after the page lists its status and its list the same way: the status while the data is read (`loading`), the list once it is (`ready`).",
    "A screen's `states` say what is visible in each container state, each state a row of the vocabulary's Container states table; the `wireframe` is the default state in Playwright's aria snapshot grammar.",
  ].join('\n\n'),
  keys: ['screen.entry', 'screen.states', 'screen.wireframe'],
}

/** The rules of a screen's routes. */
export const ROUTE_RULES: readonly ReferenceRule[] = [
  routeBindings,
  roles,
  routeExample,
  screenEntry,
]
