# Vocabulary

Contract version: 1

## Grammar

An anchor is 2 to 4 dot-separated kebab-case segments: the screen name first, the kind last.

## Kinds

| Kind | Meaning | Playwright |
|---|---|---|
| `button` | a control that performs an action | `getByRole('button')` |
| `input` | a single-line field | `getByRole('textbox')` |
| `item` | one entry of a list | `getByRole('listitem')` |
| `list` | a list of entries | `getByRole('list')` |
| `message` | a notice or a hint | `getByRole('status')` |
| `page` | the root of a screen | |
| `status` | the readiness line of a page | `getByRole('status')` |

## Derived suffixes

| Suffix | Meaning |
|---|---|
| `confirm-button` | the primary action of a dialog |
| `option` | one entry of a select |

## Attributes

| Attribute | On | Meaning |
|---|---|---|
| `data-testid` | the element | the anchor |
| `data-state` | a `status` | an app state |

## App states

| State | Meaning |
|---|---|
| `opening` | the data is being opened |
| `ready` | the screen is rendered |

## Container states

| State | Meaning |
|---|---|
| `loading` | the data is being read |

## Row states

| State | Where | Meaning |
|---|---|---|
| `current` | `sample.list.row-item` | this device |

## Codes

| Code | Where | Meaning |
|---|---|---|
| `saved` | `sample.notice-message` | the thing was saved |
| `failed` | `sample.error` | any other failure |

## Choice values

| Anchor | Value | Meaning |
|---|---|---|

## Screen names in use

| Screen | Meaning |
|---|---|
| `app-shell` | the frame around the screens |
| `not-found` | the screen of an address no route takes (`/$`) |
| `sample` | the sample screen (`/sample/$key`) |

## Roles

| Role | Meaning |
|---|---|
| `guest` | nobody signed in |
| `identity` | an account signed in |
| `member` | a member of the organisation |

## Reserved anchors

| Anchor | Meaning |
|---|---|
| `app-shell.status` | the readiness line |
| `app-shell.notice-message` | the latest notice |

## Composites

| Composite | Meaning |
|---|---|
