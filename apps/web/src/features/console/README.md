# Operator console (module `console`)

## Role in the architecture

The platform operator's console: the platform's accounts, for an account that holds the
platform role `operator`. It holds no data of its own on the device: the list goes through the
gateway's console routes over the `ACCOUNTS` port (`accountsApi` in the composition root: each
request with the credentials the tab holds as it starts, and this device's id). Layers:
`domain/` holds the search the page's address carries (`account-search.entity.ts`: the search
text, the page and its size, the sizes a page takes, and where the list comes from);
`application/` the `AccountsService` over the port and the page's machine
(`users.machine.ts`); `presentation/` the page, its view and the i18n catalogs.

## Surface

- Route: `/console/users` (roles `operator`; any other device gets the not-found page at the same
  address, its search unread) renders `UsersPage`. Its search: `q` (at most 254 characters),
  `page` (from 1, default 1) and `size` (10, 25 or 50, default 25); a value equal to its default
  stays out of the address, and `size` is retained across a new search.
- No shapes or commands: the rows come from `GET /console/accounts?q&page&size` (each account's
  identity id, name, email, verified, banned, operator and when it was made, with how many the
  search finds in all) and an account from `GET /console/accounts/:id`.
- Providers: `ACCOUNTS_SERVICE`, over the `ACCOUNTS` port.
- i18n namespace `console.*` (`presentation/i18n/console.en.json`, `console.es.json`).
- Anchors: screen `console.users` in `contract/domain/screens/console/users.yaml`.
- Behaviour: the page runs its screen's flow as its machine (`application/users.machine.ts`, held
  to the screen's flow by `platform/machines.spec.ts`) through the platform's
  `useScreenMachine`: the search button moves to the first page of what the box holds (an empty
  box leaves the text out of the address), and a row's link moves to the account's card
  (`/console/account?id=<identity>`, the id read off the row's `data-id`), which ends the page.
  The search box follows the address (`useSearchValue`): a new search, a page and Back give it
  the address's text. The list is read through the platform's `useListed` for the account signed
  in and the search keys its source reads (`q`, `page`, `size`): a change shows nothing of the
  earlier page until the new one is read, and a read whose search changed meanwhile is dropped.
  Each row shows the name, the email, the verified, banned and operator marks and when the
  account was made; the range says which accounts the page shows of how many (`pagerOf`); the
  links to the pages before and after keep the search and the size, and the size select starts
  at page 1 with the size chosen written into the address, the default included, so a default
  leaves the address and a size retained before never comes back (the platform's
  `usePageMoves`). Every link has its
  real address, and only a plain click is followed by the page itself. A read that failed shows
  `console.users.error` in the place of the list: `not-operator` (the gateway took the role away,
  and the device's record of it with it) or `failed`.

## Commands

- `bun run test` in `apps/web` runs this module's specs (`account-search.entity.spec.ts`,
  `accounts.service.spec.ts`, `users.machine.spec.ts`, `users.view.spec.tsx`,
  `users.container.spec.tsx`, `console.module.spec.ts`).
- `bun run i18n:check` checks its keys against the catalogs.
