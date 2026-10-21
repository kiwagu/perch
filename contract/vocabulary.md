# Vocabulary

Contract version: 1

The closed lists of the UI contract. Every anchor, kind, suffix, attribute, state, code,
choice value, role and screen name that `screens.json` uses is listed here once; a name
that is not here is a problem of the contract, not a new word.

## Grammar

An anchor is the value of `data-testid`. It has 2 to 4 dot-separated segments, each a
kebab-case word group (`[a-z][a-z0-9]*(-[a-z0-9]+)*`). The first one or two segments are a
screen name from "Screen names in use" (the longest match on segment boundaries wins). The
last segment is `<object>-<kind>` or just `<kind>`, where `<kind>` is its last dash-separated
word and one of "Kinds": `user.sign-in.email-input` is screen `user.sign-in`, kind `input`;
`app-shell.status` is screen `app-shell`, kind `status`; `organisation.notes.item` is screen
`organisation`, kind `item`; `user.profile.sign-out-dialog` is a `dialog`.

A derived anchor is `<anchor>.<suffix>` with a suffix from "Derived suffixes", for the parts
a composite renders on its own: `user.profile.sign-out-dialog.confirm-button`,
`app-shell.locale-select.option`. Code builds it only with `testIdFor(anchor, suffix)` from
`@workspace/ui-contract/anchors`, never by joining strings. A rendered anchor, base or
derived, has up to 5 segments and matches
`^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*){1,4}$`.

Every anchor is declared once, in one screen of `screens.json`. On a page it marks one
element, except an `item`, `row` or `option`, which marks every entry of its list, table or
select and tells them apart by `data-id` (an entity) or `data-value` (a choice).

In code an anchor is written as a literal in one of four forms, so a scan of the sources
finds every one: the attribute `data-testid="..."`; a JSX prop `testId="..."` or
`<name>TestId="..."` on a kit component; a static `testId: '...'` key of an object; a
`<NAME>_TEST_ID` constant. A literal is never computed from parts.

Tests and agents assert codes, never text. A `message`, `error`, `toast` or `dialog` carries
`data-code` with a code from "Codes": the stable name of what it says, while the wording
changes with the language. A `status`, a `list`, a `section` and an `item` carry
`data-state` with a state from "App states", "Container states" or "Row states". A choice
that is not an entity (an `option`, a `badge`, a `button` that switches a mode) carries
`data-value` with a value from "Choice values".

## Kinds

| Kind | Meaning | Playwright |
|---|---|---|
| `button` | a control that performs an action | `getByRole('button')` |
| `link` | navigation to a route | `getByRole('link')` |
| `input` | a single-line field: text, email, password | `getByRole('textbox')` |
| `textarea` | a multi-line field | `getByRole('textbox')` |
| `select` | the trigger of a choice between a few options; its options are the derived `option` | `getByRole('combobox')` |
| `checkbox` | a checkbox | `getByRole('checkbox')` |
| `radio` | one radio option | `getByRole('radio')` |
| `switch` | an on/off toggle | `getByRole('switch')` |
| `tab` | a tab in a tab strip | `getByRole('tab')` |
| `menu` | the container of a dropdown or context menu | `getByRole('menu')` |
| `nav` | a navigation container | `getByRole('navigation')` |
| `item` | one entry of a list or menu (plus `data-id` when it is an entity) | `getByRole('listitem')` |
| `option` | one entry of a select (plus `data-value`) | `getByRole('option')` |
| `row` | one entity in a table | `getByRole('row')` |
| `cell` | a value shown inside an item or row, which a test reads | |
| `card` | a standalone tile that is not a list entry | |
| `table` | a table container | `getByRole('table')` |
| `list` | a list container (plus `data-state` when its data arrives late) | `getByRole('list')` |
| `form` | a form container | |
| `dialog` | a modal or a confirmation (plus `data-code` for what it asks) | `getByRole('alertdialog')` or `getByRole('dialog')` |
| `panel` | a non-modal side or inline panel | |
| `section` | a region inside a page (plus `data-state` when its data arrives late) | |
| `page` | the root of a screen | |
| `heading` | the title of a page or a card, which a test reads | `getByRole('heading')` |
| `message` | informational text: a notice, a hint, an empty state (plus `data-code`) | |
| `error` | validation or failure text next to a field or form (plus `data-code`) | |
| `toast` | one transient notification | |
| `badge` | a marker: a counter, a role, "this device" (plus `data-value` when it names a choice) | |
| `status` | the readiness line of the app or of a page (plus `data-state`) | `getByRole('status')` |

## Derived suffixes

| Suffix | Meaning |
|---|---|
| `close-button` | the X that closes a dialog or panel |
| `confirm-button` | the primary action of a dialog |
| `cancel-button` | the secondary action of a dialog |
| `toggle-button` | opens or closes a dropdown or a select |
| `input` | the text field inside a composite |
| `option` | one entry of a select (plus `data-value`) |
| `item` | one entry a composite renders (plus `data-id`) |
| `error-message` | the error text of a field |

## Attributes

| Attribute | On | Meaning |
|---|---|---|
| `data-testid` | the element | the anchor |
| `data-id` | an `item` or `row` | the id of the entity it shows (a note, a member's identity, a device session) |
| `data-value` | an `option`, a `badge`, a `button` that switches a mode | the stable key of a choice that is not an entity; its values are rows of "Choice values" |
| `data-state` | a `status`, a `list`, a `section`, an `item` | an app, container or row state from the tables below |
| `data-code` | a `message`, `error`, `toast` or `dialog` | the stable code of the meaning; tests assert it, never the wording |
| `data-boot-step` | `<html>` | where the start of the app is (set by the composition root) |
| `data-sync-leader` | `<html>` | `1` in the tab that leads the sync, `0` elsewhere |
| `data-sync-channel` | `<html>` | the state of the tab's sync channel |

## App states

The `data-state` of `app-shell.status`.

| State | Meaning |
|---|---|
| `opening` | the local data is being opened; nothing of a screen is rendered yet |
| `ready` | the frame and the screen are rendered; a test may start |
| `failed` | the saved account's data could not be opened; the frame offers `app-shell.sign-out-here-button` |
| `storage-blocked` | the browser keeps no site data; the app stops with a message and no sign-in form |

## Container states

The `data-state` of a `list`, a `section` or a page `status`.

| State | Meaning |
|---|---|
| `loading` | the data is being read; the container shows that it waits |
| `ready` | the data was read and is shown |
| `empty` | the data was read and there is none |
| `error` | the data could not be read |

## Row states

The `data-state` of an `item`.

| State | Where | Meaning |
|---|---|---|
| `current` | `device.list.item` | this device |
| `revoked` | `device.list.item` | the device was signed out; it stays listed for a while |

## Codes

The `data-code` values. Each code is used by at least one anchor of `screens.json`.

| Code | Where | Meaning |
|---|---|---|
| `welcome` | `app-shell.notice-message` | the account signed up or signed in |
| `profile-saved` | `app-shell.notice-message` | the profile was saved |
| `invited` | `app-shell.notice-message` | an account was invited into the organisation |
| `devices-read-failed` | `app-shell.notice-message` | the devices of the account could not be read |
| `device-sign-out-failed` | `app-shell.notice-message` | signing a device, or every device, out did not go through |
| `change-rejected` | `app-shell.notice-message` | the server refused a change and this device undid it |
| `changes-reloaded` | `app-shell.notice-message` | the server refused it again; the later changes not sent yet were undone too |
| `resend-after-sign-in` | `user.sign-in.notice-message` | the device was signed out while it held changes not sent yet; signing in again as the same account sends them |
| `signed-out-elsewhere` | `user.sign-in.notice-message` | another device of the account signed this one out |
| `delete-pending` | `user.sign-in.notice-message` | the device is signed out; its data leaves it once the other tabs of the app are closed |
| `invalid-credentials` | `user.sign-in.error` | wrong email or password |
| `sign-up-rejected` | `user.sign-in.error` | no account can be created with this email |
| `rate-limited` | `user.sign-in.error`, `organisation.create.error`, `organisation.invite.error` | too many attempts; wait and try again |
| `other-account` | `user.sign-in.error` | another account is signed in on this browser; sign it out first |
| `name-required` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error` | the name is empty |
| `name-too-long` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error` | the name is longer than 80 characters |
| `bio-too-long` | `user.profile.error` | the bio is longer than 2000 characters |
| `failed` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error`, `organisation.notes.error`, `organisation.invite.error` | any other failure |
| `key-invalid` | `organisation.create.error` | the key is not 2 to 32 lowercase letters, digits and underscores starting with a letter |
| `key-taken` | `organisation.create.error` | another organisation has this key |
| `no-such-identity` | `organisation.invite.error` | no account has this email |
| `already-member` | `organisation.invite.error` | the account is already a member |
| `not-admin` | `organisation.invite.error` | only an administrator of the organisation may do this |
| `forbidden` | `organisation.notes.error` | only the author or an administrator changes a note |
| `text-required` | `organisation.notes.error` | the note is empty |
| `text-too-long` | `organisation.notes.error` | the note is longer than 500 characters |
| `no-notes` | `organisation.notes.empty-message` | the organisation has no notes yet |
| `unsent-changes` | `user.profile.sign-out-dialog` | signing out would lose changes this device has not sent |
| `sign-out-everywhere` | `device.everywhere.dialog` | signing out every device of the account, this one included |

## Choice values

The `data-value` values, per anchor.

| Anchor | Value | Meaning |
|---|---|---|
| `app-shell.locale-select.option` | `en` | English |
| `app-shell.locale-select.option` | `es` | Spanish |
| `user.sign-in.toggle-button` | `sign-up` | switch to creating an account |
| `user.sign-in.toggle-button` | `sign-in` | switch to signing in |
| `organisation.page.role-badge` | `admin` | the signed-in member administers the organisation |
| `organisation.page.role-badge` | `member` | the signed-in member is a plain member |
| `organisation.page.current-select.option` | `^[a-z][a-z0-9_]{1,31}$` | the key of the organisation it selects (a pattern: every organisation key) |

## Screen names in use

| Screen | Meaning |
|---|---|
| `app-shell` | the frame around every screen: navigation, language, status, notices |
| `user.sign-in` | signing in or creating an account (`/sign-in`) |
| `user.profile` | the signed-in account's own profile (`/me`) |
| `organisation` | the current organisation: its notes, and its members for an administrator (`/org`) |
| `device` | the devices of the signed-in account (`/devices`) |

## Roles

| Role | Meaning |
|---|---|
| `guest` | nobody signed in |
| `identity` | a signed-in account, with or without organisations |
| `member` | a member of the current organisation |
| `admin` | an administrator of the current organisation |

## Reserved anchors

Owned by the shell; a feature never declares them.

| Anchor | Meaning |
|---|---|
| `app-shell.status` | the readiness line of the app (`data-state` from "App states") |
| `app-shell.notice-message` | the latest notice for the user (`data-code`) |
| `app-shell.nav` | the main navigation |
| `app-shell.nav.sign-in-link` | the link to `/sign-in`, shown to a guest |
| `app-shell.nav.profile-link` | the link to `/me` |
| `app-shell.nav.organisation-link` | the link to `/org` |
| `app-shell.nav.devices-link` | the link to `/devices` |
| `app-shell.locale-select` | the language of the app |
| `app-shell.sign-out-here-button` | signs the saved account out on this device when its data could not be opened |
