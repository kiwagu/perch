# Vocabulary

Contract version: 1

The closed lists of the UI contract. Every kind, suffix, attribute, state, code, choice
value, role and screen name that the screen files (`contract/domain/screens/`) and the platform
file (`contract/domain/platform.yaml`) use is listed here once; the anchors themselves are declared
in the screen files. A name that is not here is a problem of the contract, not a new word:
a new word is added to its table in the same change that first uses it.

## Grammar

An anchor is the value of `data-testid`. It has 2 to 4 dot-separated segments, each a
kebab-case word group (`[a-z][a-z0-9]*(-[a-z0-9]+)*`). The first one or two segments are a
screen name from "Screen names in use" (the longest match on segment boundaries wins). The
last segment is `<object>-<kind>` or just `<kind>`, where `<kind>` is its last dash-separated
word and one of "Kinds": `user.sign-in.email-input` is screen `user.sign-in`, kind `input`;
`app-shell.status` is screen `app-shell`, kind `status`; `organisation.notes.item` is screen
`organisation`, kind `item`; `user.profile.sign-out-dialog` is a `dialog`. An anchor names
what the element is for. It never holds the element's text, colour or position, or the id
of an entity.

A derived anchor is `<anchor>.<suffix>` with a suffix from "Derived suffixes", for the parts
a composite renders on its own: `user.profile.sign-out-dialog.confirm-button`,
`app-shell.locale-select.option`. Code builds it only with `testIdFor(anchor, suffix)` from
`@workspace/ui-contract/anchors`, never by joining strings, and the base lists the suffix in
its `derived`. A rendered anchor, base or derived, has up to 5 segments and matches
`^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*){1,4}$`.

Every anchor is declared once, in one screen file. On a page it marks one element, except
an `item`, `row` or `option`, which marks every entry of its list, table or select and
tells them apart by `data-id` (an entity) or `data-value` (a choice). No declared anchor
equals another declared anchor plus a suffix of "Derived suffixes": the entries of
`device.list` are `device.list.session-item`, never `device.list.item`.

In code an anchor is written as a literal in one of four forms, so a scan of the sources
finds every one: the attribute `data-testid="..."`; a JSX prop `testId="..."` or
`<name>TestId="..."` on a kit component; a static `testId: '...'` key of an object; a
`<NAME>_TEST_ID` constant. A literal is written once in the sources and is never computed
from parts.

Tests and agents assert codes, never text. A `message`, `error`, `toast` or `dialog` carries
`data-code` with a code from "Codes": the stable name of what it says, while the wording
changes with the language. A `status`, a `list`, a `section` and an `item` carry
`data-state` with a state from "App states", "Container states" or "Row states". A choice
that is not an entity (an `option`, a `badge`, a `button` that switches a mode) carries
`data-value` with a value from "Choice values". A behaviour that differs from one case to
another is a code or a state of one anchor, never a second anchor.

## Kinds

| Kind | Meaning | Playwright |
|---|---|---|
| `button` | a control that performs an action | `getByRole('button')` |
| `link` | a control that navigates to a route | `getByRole('link')` |
| `input` | a single-line field for text, an email or a password | `getByRole('textbox')` |
| `textarea` | a field that takes several lines of text | `getByRole('textbox')` |
| `select` | the trigger of a choice between a few options, whose options are the derived `option` | `getByRole('combobox')` |
| `checkbox` | a box the user ticks or clears | `getByRole('checkbox')` |
| `radio` | one option of a group in which a single option holds | `getByRole('radio')` |
| `switch` | a toggle that turns one setting on or off | `getByRole('switch')` |
| `tab` | one tab of a tab strip | `getByRole('tab')` |
| `menu` | the container of a dropdown or context menu | `getByRole('menu')` |
| `nav` | the container of a set of navigation links | `getByRole('navigation')` |
| `item` | one entry of a list or menu, with `data-id` when it is an entity | `getByRole('listitem')` |
| `option` | one entry of a select, with `data-value` | `getByRole('option')` |
| `row` | one entity shown as a row of a table | `getByRole('row')` |
| `cell` | a value inside an item or a row that a test reads | |
| `card` | a standalone tile that is not an entry of a list | |
| `table` | the container of a table | `getByRole('table')` |
| `list` | the container of a list, with `data-state` when its data arrives after the page | `getByRole('list')` |
| `form` | the container of a form | |
| `dialog` | a modal window or a confirmation, with `data-code` for what it asks | `getByRole('alertdialog')` or `getByRole('dialog')` |
| `panel` | a side or inline panel that is not modal | |
| `section` | a region inside a page, with `data-state` when its data arrives after the page | |
| `page` | the root element of a screen | |
| `heading` | the title of a page or a card that a test reads | `getByRole('heading')` |
| `message` | an informational text such as a notice, a hint or an empty state, with `data-code` | |
| `error` | a validation or failure text next to a field or a form, with `data-code`; its `fields` name the field each code concerns | |
| `toast` | one notification that shows for a short while; several may show at once, the newest at the top, each carrying `data-code` | |
| `badge` | a marker such as a counter, a role or "this device", with `data-value` when it names a choice | |
| `status` | the readiness line of the app or of a page, with `data-state` | `getByRole('status')` |

## Derived suffixes

| Suffix | Meaning |
|---|---|
| `close-button` | the X that closes a dialog or a panel |
| `confirm-button` | the primary action of a dialog |
| `cancel-button` | the secondary action of a dialog, which closes it and changes nothing |
| `toggle-button` | the button that opens or closes a dropdown or a select |
| `input` | the text field inside a composite |
| `option` | one entry of a select, with `data-value` |
| `item` | one entry a composite renders, with `data-id` |
| `error-message` | the error text of a field |

## Attributes

| Attribute | On | Meaning |
|---|---|---|
| `data-testid` | the element | the anchor of the element |
| `data-id` | an `item` or `row` | the id of the entity the entry shows (a note, a member's identity, a device session) |
| `data-value` | an `option`, a `badge`, a `button` that switches a mode | the stable key of a choice that is not an entity, one of the rows of "Choice values" |
| `data-state` | a `status`, a `list`, a `section`, an `item` | an app, container or row state from the tables below |
| `data-code` | a `message`, `error`, `toast` or `dialog` | the stable code of what the element says, which tests assert instead of the wording |
| `data-boot-step` | `<html>` | the step the start of the app has reached, set by the composition root |
| `data-sync-leader` | `<html>` | `1` in the tab that leads the sync and `0` in every other tab |
| `data-sync-channel` | `<html>` | the state of the tab's sync channel |

## App states

The `data-state` of `app-shell.status`.

| State | Meaning |
|---|---|
| `opening` | the local data is being opened and no screen is rendered yet |
| `ready` | the frame and the screen are rendered, so a test may start |
| `failed` | the saved account's data could not be opened, and the frame offers `app-shell.sign-out-here-button` |
| `storage-blocked` | the browser keeps no site data, so the app stops with a message and shows no sign-in form |

## Container states

The `data-state` of a `list`, a `section` or a page `status`.

| State | Meaning |
|---|---|
| `loading` | the data is being read and the container shows that it waits |
| `ready` | the data was read and is shown |
| `empty` | the data was read and there is none to show |
| `error` | the data could not be read |

## Row states

The `data-state` of an `item` whose entity differs from the others or changes while it stays
listed. An entry in its normal state carries no `data-state`, and a row state is never a
container state.

| State | Where | Meaning |
|---|---|---|
| `current` | `device.list.session-item` | the entry is the device this browser runs on |
| `revoked` | `device.list.session-item` | the device was signed out and stays listed for a while |

## Codes

The `data-code` values. Each code is used by at least one anchor of the screen files, and a
dialog's code names what it asks (`unsent-changes`), not the answer.

| Code | Where | Meaning |
|---|---|---|
| `welcome` | `app-shell.notice-message` | the account signed up or signed in |
| `profile-saved` | `app-shell.notice-message` | the profile was saved |
| `invited` | `app-shell.notice-message` | an account was invited into the organisation |
| `devices-read-failed` | `app-shell.notice-message` | the devices of the account could not be read |
| `device-sign-out-failed` | `app-shell.notice-message` | signing a device, or every device, out did not go through |
| `change-rejected` | `app-shell.notice-message` | the server refused a change and this device undid it |
| `changes-reloaded` | `app-shell.notice-message` | the server refused a change again, and the later changes not sent yet were undone too |
| `locale-not-stored` | `app-shell.notice-message` | the chosen language applies on this device, but the account's settings could not store it |
| `<object>-<verb>ed` | `app-shell.toast` | the success of an action of the model, derived for each one a flow invokes: its object, then the past of its verb (`note-created`, `note-updated`, `note-deleted`), or `<action>-done` for another verb |
| `resend-after-sign-in` | `user.sign-in.notice-message` | the device was signed out while it held changes not sent yet, and signing in again as the same account sends them |
| `signed-out-elsewhere` | `user.sign-in.notice-message` | another device of the account signed this one out |
| `delete-pending` | `user.sign-in.notice-message` | the device is signed out, and its data leaves it once the other tabs of the app are closed |
| `invalid-credentials` | `user.sign-in.error` | the email or the password is wrong |
| `sign-up-rejected` | `user.sign-in.error` | no account can be created with this email |
| `rate-limited` | `user.sign-in.error`, `organisation.create.error`, `organisation.invite.error` | too many attempts were made, so the user waits and tries again |
| `other-account` | `user.sign-in.error` | another account is signed in on this browser and must be signed out first |
| `name-required` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error` | the name is empty |
| `name-too-long` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error` | the name is longer than 80 characters |
| `bio-too-long` | `user.profile.error` | the bio is longer than 2000 characters |
| `failed` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error`, `organisation.notes.error`, `organisation.invite.error` | the action failed for any other reason |
| `key-invalid` | `organisation.create.error` | the key is not 2 to 32 lowercase letters, digits and underscores starting with a letter |
| `key-taken` | `organisation.create.error` | another organisation already has this key |
| `no-such-identity` | `organisation.invite.error` | no account has this email |
| `already-member` | `organisation.invite.error` | the account is already a member of the organisation |
| `not-admin` | `organisation.invite.error` | only an administrator of the organisation may do this |
| `forbidden` | `organisation.notes.error` | only the author of a note or an administrator may change it |
| `text-required` | `organisation.notes.error` | the note is empty |
| `text-too-long` | `organisation.notes.error` | the note is longer than 500 characters |
| `no-notes` | `organisation.notes.empty-message` | the organisation has no notes yet |
| `unsent-changes` | `user.profile.sign-out-dialog` | the dialog asks whether to sign out and lose the changes this device has not sent |
| `sign-out-everywhere` | `device.everywhere.dialog` | the dialog asks whether to sign out every device of the account, this one included |
| `unsaved-input` | `app-shell.leave-dialog` | the dialog asks whether to leave and lose what was typed but not saved |

## Choice values

The `data-value` values, per anchor. A value is the key the code already uses for the
choice, never its label, and its meaning says what the choice is, not how the page words it.

| Anchor | Value | Meaning |
|---|---|---|
| `app-shell.locale-select.option` | `en` | the option makes the app speak English |
| `app-shell.locale-select.option` | `es` | the option makes the app speak Spanish |
| `user.sign-in.toggle-button` | `sign-up` | the button switches the form to creating an account |
| `user.sign-in.toggle-button` | `sign-in` | the button switches the form to signing in |
| `organisation.page.role-badge` | `admin` | the signed-in member administers the organisation |
| `organisation.page.role-badge` | `member` | the signed-in member is a plain member of the organisation |
| `organisation.page.current-select.option` | `^[a-z][a-z0-9_]{1,31}$` | the option selects the organisation with this key (a pattern that every organisation key matches) |

## Screen names in use

A screen name prefixes every anchor of its screen. A pane that several screens open gets a
screen name of its own.

| Screen | Meaning |
|---|---|
| `app-shell` | the frame around every screen, with the navigation, the language, the status and the notices |
| `user.sign-in` | the page that signs an account in or creates one (`/sign-in`) |
| `user.profile` | the signed-in account's own profile (`/me`) |
| `organisation` | the current organisation with its notes, and its members for an administrator (`/org`) |
| `device` | the devices of the signed-in account (`/devices`) |

## Roles

| Role | Meaning |
|---|---|
| `guest` | nobody is signed in on the device |
| `identity` | an account is signed in, with or without organisations |
| `member` | the signed-in account is a member of the current organisation |
| `admin` | the signed-in account administers the current organisation |

## Reserved anchors

Owned by the shell, which renders each of them once; a feature never declares or renders
them. Each row says what the anchor renders on top of its own element, its derived anchors
included.

| Anchor | Meaning |
|---|---|
| `app-shell.status` | the readiness line of the app, which carries `data-state` from "App states" and renders no derived anchor |
| `app-shell.notice-message` | the latest notice for the user, one at a time, which carries `data-code` and renders no derived anchor |
| `app-shell.nav` | the main navigation, whose links are the four anchors below, declared on their own and not derived |
| `app-shell.nav.sign-in-link` | the link to `/sign-in`, shown to a guest, which renders no derived anchor |
| `app-shell.nav.profile-link` | the link to `/me`, which renders no derived anchor |
| `app-shell.nav.organisation-link` | the link to `/org`, which renders no derived anchor |
| `app-shell.nav.devices-link` | the link to `/devices`, which renders no derived anchor |
| `app-shell.locale-select` | the language of the app, which renders `app-shell.locale-select.option` for each language with its value in `data-value` |
| `app-shell.sign-out-here-button` | the button that signs the saved account out on this device when its data could not be opened, which renders no derived anchor |
| `app-shell.leave-dialog` | the dialog that asks before a leave loses unsaved input, which carries `data-code` and renders `app-shell.leave-dialog.confirm-button` (leave) and `app-shell.leave-dialog.cancel-button` (stay) |
| `app-shell.toast` | the toasts of what the user changed, the newest at the top, each rendered as one `app-shell.toast` carrying `data-code`; tests locate one by its code, `[data-testid="app-shell.toast"][data-code="note-created"]`; it renders no derived anchor |
