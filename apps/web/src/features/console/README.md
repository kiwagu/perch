# Operator console (module `console`)

## Role in the architecture

The platform operator's console: the platform's accounts, for an account that holds the
platform role `operator`, and the card of one account with the actions an operator takes on it.
It holds no data of its own on the device: the list, the card and the actions go through the
gateway's console routes over the `ACCOUNTS` port (`accountsApi` in the composition root: each
request with the credentials the tab holds as it starts, and this device's id). Layers:
`domain/` holds the searches the pages' addresses carry (`account-search.entity.ts`: the search
text, the page and its size, the sizes a page takes, and where the list comes from;
`account-card.entity.ts`: the account's id, where the card comes from, `accountIdOf`, and the
longest reason of a ban); `application/` the `AccountsService` over the port and the pages'
machines (`users.machine.ts`, `account-machine/`); `presentation/` the pages, their views, the
marks they share (`components/mark-badge`) and the i18n catalogs.

## Surface

- Route: `/console/users` (roles `operator`; any other device gets the not-found page at the same
  address, its search unread) renders `UsersPage`. Its search: `q` (at most 254 characters),
  `page` (from 1, default 1) and `size` (10, 25 or 50, default 25); a value equal to its default
  stays out of the address, and `size` is retained across a new search.
- Route: `/console/account` (roles `operator`, likewise) renders `AccountPage`. Its search: `id`
  (1 to 64 characters), the identity id of the account.
- Both pages are lazy pages (`LazyPage`): their code (containers, views, machines) loads apart
  from the first frame, when an operator first opens one of them, never for any other device; the
  routes, their search schemas (`domain/`) and the service stay in the first frame.
- No shapes or commands: the rows come from `GET /console/accounts?q&page&size` (each account's
  identity id, name, email, verified, banned, operator and when it was made, with how many the
  search finds in all), an account from `GET /console/accounts/:id`, and the actions are
  `POST /console/accounts/:id/{rename,email,ban,unban,sign-out,reset,verification,removal}`.
- Providers: `ACCOUNTS_SERVICE`, over the `ACCOUNTS` port.
- i18n namespace `console.*` (`presentation/i18n/console.en.json`, `console.es.json`).
- Anchors: screens `console.users` and `console.account` in `contract/domain/screens/console/`.
- Behaviour of the accounts: the page runs its screen's flow as its machine
  (`application/users.machine.ts`, held to the screen's flow by `platform/machines.spec.ts`)
  through the platform's `useScreenMachine`: the search button moves to the first page of what
  the box holds (an empty box leaves the text out of the address), and a row's link moves to the
  account's card (`/console/account?id=<identity>`, the id read off the row's `data-id`), which
  ends the page. The search box follows the address (`useSearchValue`): a new search, a page and
  Back give it the address's text. The list is read through the platform's `useListed` for the
  account signed in and the search keys its source reads (`q`, `page`, `size`): a change shows
  nothing of the earlier page until the new one is read, and a read whose search changed
  meanwhile is dropped. Each row shows the name, the email, the verified, banned and operator
  marks and when the account was made; the range says which accounts the page shows of how many
  (`pagerOf`); the links to the pages before and after keep the search and the size, and the
  size select starts at page 1 with the size chosen written into the address, the default
  included, so a default leaves the address and a size retained before never comes back (the
  platform's `usePageMoves`). Every link has its real address, and only a plain click is
  followed by the page itself; each is a touch target of 44 by 44 CSS px at least. A read that
  failed shows `console.users.error` in the place of the list: `not-operator` (the gateway took
  the role away, and the device's record of it with it) or `failed`.
- Behaviour of the card: the page runs its screen's flow as its machine
  (`application/account-machine/`, held to the flow by `platform/machines.spec.ts`): `viewing`
  runs the areas in parallel, the name, the email, the ban (ban or unban), the sessions, the
  reset, the verification and the removal, each running one action at a time, its control
  enabled while the flow takes its event. The account is read through `useListed` for the
  account signed in and the `id` of the address, and again each time the flow reads the section
  after an action, done or refused, the card shown as read meanwhile; another id in the address
  starts the card afresh. An address with no id, or with one that is no identity id, names no
  account: the card says `account-gone`, the gateway not asked. Once read, the heading names the
  account, and the section shows its email, when it was made and last seen, its verified, banned
  and operator marks, the ban's reason while banned, and its organisations with its role in each;
  the name form shows only while the account has a profile, the resend only while its email is
  not verified, the ban form a reason (at most 500 characters) and the ban while it is not
  banned, the lift of the ban while it is. A done action says itself in the frame's toast; the
  email's field empties once its mail is on its way, the reason's once the account is banned, and
  a removal moves to the accounts. A refused action shows its code in its area's error: under
  the field it concerns for `name-required`, `name-too-long`, `email-invalid` and `email-taken`,
  above the area's controls for any other; a done action forgets its area's error. The ban, the
  sign-out everywhere and the removal ask the frame's confirmation first
  (`platform/confirmations.ts`). A read that failed shows `console.account.error` in the place of
  the section: `not-operator`, `account-gone` or `failed`. Every link and button of the card is
  a touch target of 44 by 44 CSS px at least.

## Commands

- `bun run test` in `apps/web` runs this module's specs (`account-search.entity.spec.ts`,
  `account-card.entity.spec.ts`, `accounts.service.spec.ts`, `users.machine.spec.ts`,
  `account-machine/machine.spec.ts`, `users.view.spec.tsx`, `users.container.spec.tsx`,
  `account.view.spec.tsx`, `account.container.spec.tsx`, `console.module.spec.ts`,
  `console-pages.spec.ts`).
- `bun run i18n:check` checks its keys against the catalogs.
