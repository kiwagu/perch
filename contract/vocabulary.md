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

A composite's anchors are declared anchors the loader derives, not derived parts. A secret
`input` that opts into a composite of the platform (`composite: password-rules`) declares on
its screen `<screen>.<list>`, a `list`, and `<screen>.<list>.<item>-item`, an `item` per item
of the composite: `user.settings.password-rule-list.digit-item` is screen `user.settings`,
kind `item`. They follow the grammar above, no screen file writes them, and "Composites" names
each composite.

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
`data-value` with a value from "Choice values". A `visibility-button`, the eye a password
`input` renders, carries `data-value` `show` or `hide`, the values its suffix defines, never
rows of "Choice values". A behaviour that differs from one case to another is a code or a
state of one anchor, never a second anchor.

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
| `confirmation` | the frame's question before a destructive action, one for the whole app: an alert dialog with `data-code` for the action it asks about, rendering `confirm-button` (go on) and `cancel-button` (stay) | `getByRole('alertdialog')` |
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
| `range` | the text of a paged list that says which entries the page shows and how many there are in all, carrying `data-from`, `data-to` and `data-total`; shown once its read is in |
| `previous-link` | the link of a paged list to the page before, on every page but the first |
| `next-link` | the link of a paged list to the page after, on every page that does not hold the last entry |
| `size-select` | the select of a paged list's page size, shown wherever the list is: its options are the sizes its action declares, each carrying its size as `data-value` |
| `visibility-button` | the eye beside a password `input` that shows what the input holds as typed, or hides it again: it carries `data-value` `show` while the input hides its value (a click shows it) and `hide` while it shows it, so the value names what the click does; only an `input` renders it, and it is presentation only, never an event of a flow or an activity, never a value an action takes, and always enabled |

## Attributes

| Attribute | On | Meaning |
|---|---|---|
| `data-testid` | the element | the anchor of the element |
| `data-id` | an `item` or `row` | the id of the entity the entry shows (a note, a member's identity, a device session) |
| `data-value` | an `option`, a `badge`, a `button` that switches a mode, a `visibility-button` | the stable key of a choice that is not an entity, one of the rows of "Choice values"; on a `visibility-button`, `show` or `hide`, the values of its suffix; on an option of a paged list's `size-select`, the page size it chooses |
| `data-state` | a `status`, a `list`, a `section`, an `item` | an app, container or row state from the tables below |
| `data-code` | a `message`, `error`, `toast` or `dialog` | the stable code of what the element says, which tests assert instead of the wording |
| `data-from` | the `range` of a paged list | the number of the first entry the page shows, from 1; `0` when it shows none |
| `data-to` | the `range` of a paged list | the number of the last entry the page shows; `0` when it shows none |
| `data-total` | the `range` of a paged list | the number of entries the search finds in all |
| `data-boot-step` | `<html>` | the step the start of the app has reached, set by the composition root |
| `data-sync-leader` | `<html>` | `1` in the tab that leads the sync and `0` in every other tab |
| `data-sync-channel` | `<html>` | the state of the tab's sync channel |

## App states

The `data-state` of `app-shell.status`.

| State | Meaning |
|---|---|
| `opening` | the app starts: it checks the site storage and who is signed in, and no screen is rendered yet |
| `opening-data` | the signed-in account's frame and the open screen are rendered while its local data is being opened |
| `ready` | the frame and the screen are rendered, and a signed-in account's data is open, so a test may start |
| `failed` | the saved account's data could not be opened, and the frame offers `app-shell.sign-out-here-button` |
| `start-failed` | the app's code did not load or run, so it did not start, and the frame offers no sign-out |
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
| `met` | each item of the composite `password-rules` | the password typed keeps this rule |

## Codes

The `data-code` values. Each code is used by at least one anchor of the screen files, and a
dialog's code names what it asks (`unsent-changes`), not the answer.

| Code | Where | Meaning |
|---|---|---|
| `welcome` | `app-shell.notice-message` | the account signed in, or its email was verified and this device signed in to it |
| `devices-read-failed` | `app-shell.notice-message` | the devices of the account could not be read |
| `device-sign-out-failed` | `app-shell.notice-message` | signing a device, or every device, out did not go through |
| `change-rejected` | `app-shell.notice-message` | the server refused a change and this device undid it |
| `changes-reloaded` | `app-shell.notice-message` | the server refused a change again, and the later changes not sent yet were undone too |
| `locale-not-stored` | `app-shell.notice-message` | the chosen language applies on this device, but the account's settings could not store it |
| `theme-not-stored` | `app-shell.notice-message` | the chosen theme applies on this device, but the account's settings could not store it |
| `profile-saved` | `app-shell.toast` | the profile was saved, said by Save itself when nothing changed |
| `<object>-<verb>ed` | `app-shell.toast` | the outcome of an operation, derived once where it ends: for one action of the model its object, then the past of its verb (`note-created`, `note-updated`, `note-deleted`), or `<action>-done` for another verb; for a platform action the code the platform's `toasts` map gives it (`organisation-created`, `member-removed`, `device-signed-out`); for a chain of actions the part of the control that starts it, then the past of its verb (`user.profile.save-button` gives `profile-saved`) |
| `<object>-<verb>` | `app-shell.confirmation` | the question before a destructive action, derived for each control that runs one: for an action of the model its object, then the verb (`note-delete`); for a platform action its name with `.` as `-` (`organisations-remove`, `devices-revoke`) |
| `resend-after-sign-in` | `user.sign-in.notice-message` | the device was signed out while it held changes not sent yet, and signing in again as the same account sends them |
| `signed-out-elsewhere` | `user.sign-in.notice-message` | another device of the account signed this one out |
| `password-changed-elsewhere` | `user.sign-in.notice-message` | the account's password changed on another device or through a reset link, which signed this device out; it signs in with the new password |
| `device-limit-elsewhere` | `user.sign-in.notice-message` | a sign-in on another device went past the number of devices the account may be signed in on at once, which signed this device out, the one seen least recently |
| `password-reset-elsewhere` | `user.sign-in.notice-message` | a new password was set in another tab of this browser through the link of a reset mail, which the tab that asked for the mail follows; the account signs in with it |
| `delete-pending` | `user.sign-in.notice-message` | the device is signed out, and its data leaves it once the other tabs of the app are closed |
| `check-your-mail` | `user.sign-in.mail-message`, `user.verify-email.message`, `user.forgot-password.message`, `user.settings.email.message`, `user.settings.deletion.message` | a mail with a link is on its way to the email typed, if that email has an account the mail is for (one waiting for its verification, one whose password is to be set anew, or a new email no account has yet), or to the signed-in account's own email for its deletion; the same words when the email typed has none, so the page tells nobody which emails have accounts |
| `email-not-verified` | `user.sign-in.error` | the email and the password are right, but the account's email is not verified yet: the link of its verification mail signs it in |
| `verified-before` | `user.verify-email.message` | the link's email was verified before; the account signs in on the sign-in page |
| `link-invalid` | `user.verify-email.error`, `user.reset-password.error`, `user.confirm-email.error`, `user.delete-account.error`, `organisation.invitation.error` | the link is not one a mail of the app carried, it was used before or replaced by a newer one, or what it was for no longer holds (its account or its organisation is gone, the account changed since the mail was sent, or the invitation was declined or revoked) |
| `link-expired` | `user.verify-email.error`, `user.reset-password.error`, `user.confirm-email.error`, `user.delete-account.error`, `organisation.invitation.error` | the link is too old: a verification or confirmation link after a day, a reset or deletion link after an hour, an invitation's after seven days; a new one is asked for |
| `invalid-credentials` | `user.sign-in.error`, `user.settings.password.error`, `user.settings.email.error`, `user.settings.deletion.error` | the email or the password is wrong |
| `sign-up-rejected` | `user.sign-in.error` | no account can be created with these details: the email is not an email, or the password breaks the password rules (the page's list of rules says which) |
| `password-rejected` | `user.reset-password.error`, `user.settings.password.error` | the new password breaks the password rules, so the password stays what it was |
| `email-invalid` | `user.settings.email.error`, `organisation.invite.error` | the email typed is not an email |
| `password-reset` | `user.reset-password.message` | the password is the new one and every device of the account is signed out; the account signs in with it |
| `email-changed` | `user.confirm-email.message` | the account's email is the new one, which signs it in from now on |
| `sign-in-to-accept` | `organisation.invitation.message` | the invitation is for the account with the email its mail went to: sign in to it, or create it, then accept the invitation here or on the organisation page |
| `invitation-gone` | `organisation.invitation.error`, `organisation.received.error` | the invitation was revoked, replaced by a newer one, accepted, declined or expired meanwhile |
| `account-deleted` | `user.delete-account.message` | the account is gone for good, with its data, and every device of it is signed out; its email can sign up again |
| `passwords-differ` | `user.sign-in.error`, `user.reset-password.error`, `user.settings.password.error` | the password typed again is not the same as the password, so no account is asked for and nothing is sent |
| `rate-limited` | `user.sign-in.error`, `user.verify-email.error`, `organisation.create.error`, `organisation.invite.error`, `user.forgot-password.error`, `user.reset-password.error`, `user.confirm-email.error`, `user.settings.password.error`, `user.settings.email.error`, `user.settings.deletion.error`, `user.delete-account.error`, `organisation.invitation.error` | too many attempts were made, so the user waits and tries again |
| `other-account` | `user.sign-in.error`, `user.verify-email.error`, `organisation.invitation.error`, `organisation.received.error` | another account is signed in on this browser and must be signed out first |
| `name-required` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error` | the name is empty |
| `name-too-long` | `user.sign-in.error`, `user.profile.error`, `organisation.create.error` | the name is longer than 80 characters |
| `bio-too-long` | `user.profile.error` | the bio is longer than 2000 characters |
| `failed` | `user.sign-in.error`, `user.verify-email.error`, `user.forgot-password.error`, `user.reset-password.error`, `user.confirm-email.error`, `user.settings.password.error`, `user.settings.email.error`, `user.settings.deletion.error`, `user.delete-account.error`, `user.profile.error`, `organisation.create.error`, `organisation.notes.error`, `organisation.invite.error`, `organisation.invitation.error`, `organisation.received.error` | the action failed for any other reason |
| `key-invalid` | `organisation.create.error` | the key is not 2 to 32 lowercase letters, digits and underscores starting with a letter |
| `key-taken` | `organisation.create.error` | another organisation already has this key |
| `already-member` | `organisation.invite.error`, `organisation.invitation.error`, `organisation.received.error` | the account is already a member of the organisation |
| `not-admin` | `organisation.invite.error` | only an administrator of the organisation may do this |
| `last-admin` | `user.settings.deletion.error`, `user.delete-account.error`, `organisation.invite.error` | the account is the only administrator of an organisation: it cannot be made a member until another member is made an administrator, nor deleted while the organisation has other members until one of them is made an administrator or they are removed; the organisation page shows them |
| `forbidden` | `organisation.notes.error` | only the author of a note or an administrator may change it |
| `text-required` | `organisation.notes.error` | the note is empty |
| `text-too-long` | `organisation.notes.error` | the note is longer than 500 characters |
| `no-notes` | `organisation.notes.empty-message` | the organisation has no notes yet |
| `unsent-changes` | `user.profile.sign-out-dialog` | the dialog asks whether to sign out and lose the changes this device has not sent |
| `sign-out-everywhere` | `device.everywhere.dialog` | the dialog asks whether to sign out every device of the account, this one included |
| `device-limit` | `user.sign-in.device-limit-dialog` | the dialog asks whether to sign in all the same and sign out the account's device seen least recently, since the account is signed in on as many devices as it may be at once |
| `unsaved-input` | `app-shell.leave-dialog` | the dialog asks whether to leave and lose what was typed but not saved |
| `screen-crashed` | `app-shell.crash-message` | the open screen failed to render; another screen, a language chosen or a reload may bring it back |
| `new-version` | `app-shell.update-message` | the server serves a newer version of the app than the one this tab runs, and loading the page again brings it |
| `protocol-outdated` | `app-shell.update-message` | the server no longer takes the sync protocol of the version this tab runs, so this device's changes stop syncing until the page loads again |
| `synced` | `app-shell.sync-message` | the sync is connected and no change made on this device waits to be sent |
| `sending` | `app-shell.sync-message` | the sync is connected and changes made on this device are on their way to the server |
| `connecting` | `app-shell.sync-message` | the browser has a network, but the sync is not connected yet, or connects again |
| `offline` | `app-shell.sync-message` | the browser has no network, so changes made on this device wait here until it is back |
| `sync-stopped` | `app-shell.sync-message` | the sync stopped and does not resume in this page: the server no longer takes its protocol, or the browser cannot lead a sync |
| `install-available` | `app-shell.install-message` | the browser can install the app and offers to; the reminder carries the button that asks it |
| `install-by-steps` | `app-shell.install-message` | the browser installs the app only by the user's own steps, which the reminder shows (Share, then Add to Home Screen) |

## Choice values

The `data-value` values, per anchor. A value is the key the code already uses for the
choice, never its label, and its meaning says what the choice is, not how the page words it.

| Anchor | Value | Meaning |
|---|---|---|
| `app-shell.locale-select.option` | `en` | the option makes the app speak English |
| `app-shell.locale-select.option` | `es` | the option makes the app speak Spanish |
| `app-shell.theme-select.option` | `light` | the option shows the app light on this device |
| `app-shell.theme-select.option` | `dark` | the option shows the app dark on this device |
| `app-shell.theme-select.option` | `system` | the option shows the app as the device's own setting says, following it as it changes |
| `user.settings.locale-select.option` | `en` | the option makes the account speak English |
| `user.settings.locale-select.option` | `es` | the option makes the account speak Spanish |
| `user.settings.theme-select.option` | `light` | the option shows the account light, in each of its tabs and on each of its devices |
| `user.settings.theme-select.option` | `dark` | the option shows the account dark, in each of its tabs and on each of its devices |
| `user.settings.theme-select.option` | `system` | the option shows the account as each device's own setting says, following it as it changes |
| `user.sign-in.toggle-button` | `sign-up` | the button switches the form to creating an account |
| `user.sign-in.toggle-button` | `sign-in` | the button switches the form to signing in |
| `organisation.page.role-badge` | `admin` | the signed-in member administers the organisation |
| `organisation.page.role-badge` | `member` | the signed-in member is a plain member of the organisation |
| `organisation.invitation.role-badge` | `admin` | the invitation makes the account an administrator of the organisation |
| `organisation.invitation.role-badge` | `member` | the invitation makes the account a plain member of the organisation |
| `organisation.invite.role-select.option` | `member` | the option invites the account as a plain member |
| `organisation.invite.role-select.option` | `admin` | the option invites the account as an administrator |
| `organisation.members.role-select.option` | `member` | the option makes the member a plain member |
| `organisation.members.role-select.option` | `admin` | the option makes the member an administrator |
| `organisation.sent.role-badge` | `member` | the invitation makes the account a plain member |
| `organisation.sent.role-badge` | `admin` | the invitation makes the account an administrator |
| `organisation.received.role-badge` | `member` | the invitation makes the account a plain member |
| `organisation.received.role-badge` | `admin` | the invitation makes the account an administrator |
| `organisation.page.current-select.option` | `^[a-z][a-z0-9_]{1,31}$` | the option selects the organisation with this key (a pattern that every organisation key matches) |

## Screen names in use

A screen name prefixes every anchor of its screen. A pane that several screens open gets a
screen name of its own.

| Screen | Meaning |
|---|---|
| `app-shell` | the frame around every screen, with the navigation, the language, the status and the notices |
| `user.sign-in` | the page that signs an account in or creates one (`/sign-in`) |
| `user.verify-email` | the page the link of a verification mail opens, which verifies the email and signs the account in (`/verify-email`) |
| `user.forgot-password` | the page that asks for a mail whose link sets a new password (`/forgot-password`) |
| `user.reset-password` | the page the link of a password reset mail opens, which sets a new password (`/reset-password`) |
| `user.confirm-email` | the page the link of an email confirmation mail opens, which changes the account's email (`/confirm-email`) |
| `user.profile` | the signed-in account's own profile (`/me`) |
| `organisation` | the organisations of the account and the invitations to it: the current one with its notes, and its members and invitations for an administrator (`/org`) |
| `device` | the devices of the signed-in account (`/devices`) |
| `not-found` | what an address no other route takes opens (`/$`) |
| `user.settings` | the settings of the signed-in account: the theme, the language, the password and the email, and the deletion of the account (`/settings`) |
| `user.delete-account` | the page the link of an account deletion mail opens, which deletes the account on a press (`/delete-account`) |
| `organisation.invitation` | the page the link of an invitation mail opens, where the invited account accepts or declines it (`/invitation`) |

## Roles

| Role | Meaning |
|---|---|
| `guest` | nobody is signed in on the device; for the frame also a device whose saved account is not open: while the app starts, when its start or its data fails, and while it signs out from there |
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
| `app-shell.nav.profile-link` | the link to `/me`, which renders no derived anchor |
| `app-shell.nav.organisation-link` | the link to `/org`, which renders no derived anchor |
| `app-shell.nav.devices-link` | the link to `/devices`, which renders no derived anchor |
| `app-shell.nav.settings-link` | the link to `/settings`, which renders no derived anchor |
| `app-shell.theme-select` | the theme of this device for a guest, which renders `app-shell.theme-select.option` for each theme with its value in `data-value` |
| `app-shell.locale-select` | the language of the app, which renders `app-shell.locale-select.option` for each language with its value in `data-value` |
| `app-shell.sign-out-here-button` | the button that signs the saved account out on this device when its data could not be opened, which renders no derived anchor |
| `app-shell.leave-dialog` | the dialog that asks before a leave loses unsaved input, which carries `data-code` and renders `app-shell.leave-dialog.confirm-button` (leave) and `app-shell.leave-dialog.cancel-button` (stay) |
| `app-shell.confirmation` | the frame's question before a destructive action, which carries `data-code` and renders `app-shell.confirmation.confirm-button` (go on) and `app-shell.confirmation.cancel-button` (stay) |
| `app-shell.crash-message` | the message in the place of a screen that failed to render, which carries `data-code` and renders no derived anchor |
| `app-shell.reload-button` | the button that loads the page again, shown with `app-shell.crash-message`, which renders no derived anchor |
| `app-shell.update-message` | the message that the page should load again, a newer version served or the sync protocol refused, which carries `data-code` and renders no derived anchor |
| `app-shell.update-button` | the button that loads the page again on the version the server serves, shown with `app-shell.update-message`, which renders no derived anchor |
| `app-shell.sync-message` | the state of this device's sync for a signed-in account, the same in every tab, which carries `data-code` and renders no derived anchor |
| `app-shell.install-message` | the reminder to install the app until it is installed, which carries `data-code` and renders no derived anchor |
| `app-shell.install-button` | the button that asks the browser to install the app, shown with `app-shell.install-message` where the browser can, which renders no derived anchor |
| `app-shell.install-later-button` | the button that puts the reminder off for three days on this device, shown with `app-shell.install-message`, which renders no derived anchor |
| `app-shell.toast` | the toasts of what the user changed, the newest at the top, each rendered as one `app-shell.toast` carrying `data-code`; tests locate one by its code, `[data-testid="app-shell.toast"][data-code="note-created"]`; it renders no derived anchor |

## Composites

What the platform declares once and a screen derives by opting in (`platform.yaml`
`composites`): the list with its items, their descriptions and their item state, so no screen
repeats them. A row names the composite and what it is for.

| Composite | Meaning |
|---|---|
| `password-rules` | the rules a new password keeps, listed under the field that takes it, each marked once the password typed keeps it |
