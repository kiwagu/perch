# Vocabulary

Contract version: 1

## Grammar

An anchor is 2 to 4 dot-separated kebab-case segments: the screen name first, the kind last.

## Kinds

| Kind | Meaning | Playwright |
|---|---|---|
| `button` | a control that performs an action | `getByRole('button')` |
| `input` | a single-line field | `getByRole('textbox')` |
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
| `ready` | the screen is rendered |

## Container states

| State | Meaning |
|---|---|
| `loading` | the data is being read |

## Row states

| State | Where | Meaning |
|---|---|---|
| `current` | `sample.list.item` | this device |

## Codes

| Code | Where | Meaning |
|---|---|---|
| `saved` | `sample.notice-message` | the thing was saved |
| `failed` | `sample.error` | any other failure |

## Choice values

| Anchor | Value | Meaning |
|---|---|---|
| `sample.mode-select.option` | `light` | a light page |
| `sample.mode-select.option` | `dark` | a dark page |
| `sample.size-badge` | `small` | a small thing |

## Screen names in use

| Screen | Meaning |
|---|---|
| `sample` | the sample screen (`/sample`) |

## Roles

| Role | Meaning |
|---|---|
| `guest` | nobody signed in |
| `member` | a member of the organisation |

## Reserved anchors

| Anchor | Meaning |
|---|---|
| `sample.status` | the readiness line |
