# Templates

The same two templates stand in `contract/README.md` for people.

## Request (tester to developer)

When a scenario or a test needs an element the contract does not give it (no anchor, an
anchor without the code or the value it needs, or nothing in the contract at all), the
writer asks for the contract change in this form instead of working around it in the test:

```text
Anchor needed
Screen: <path> (<screen id>), role: <role>
Element: <what it is, in the words of the scenario>
Today: <no anchor | an anchor without this code | an anchor without this value | not in the contract>; the test finds it by <role, label or text>
Proposed: <anchor by the grammar> [+ data-code="<code>" | + data-value="<value>" | + data-state="<state>"]
In the tests: tests/e2e/src/<id>.e2e.spec.ts, scenario <id>
Why: without it the test depends on the wording or the layout and breaks when they change
```

## Review (before the code)

The stop of the review gate (`.cursor/rules/ui-contract.mdc`): the contract changed, the code
has not. The developer gets, and answers with an OK or with changes to the contract:

```text
<the output of bun run contract:diff main>

The contract files: <the diff of contract/ and tests/e2e/scenarios/, or where to read it>
Why:
- <every change, an added state, guard, facet or code included>: <the reason>
Gaps signalled: <the Contract gap: blocks, or none>
```

## Hand-off (developer)

A change to the contract carries the output of `bun run contract:diff main` in its
description, and below it, by hand, the reason for each rename or removal and the scenarios
and tests changed with it. The diff leaves out the lists that are empty:

```text
<the output of bun run contract:diff main>

Why:
- <each anchor, code, screen, entity, field, activity or transition renamed or removed>: <the reason>
Scenarios and tests changed with it: <scenario ids>
```

For example, renaming the revoke button of the devices page:

```text
contract changes: 1 anchor renamed
anchors renamed: device.list.revoke-button -> device.list.sign-out-button

Why:
- device.list.revoke-button: the button signs the device out, and the anchor now says so
Scenarios and tests changed with it: device/base/my-devices
```

An anchor removed and one added are shown as a rename when they are the only ones of their
screen and kind; otherwise they stay in the added and removed lists, and the reason says
which replaced which. The tests live in this repository, so the change that renames an
anchor updates them too; `bun run contract:check:consumers` fails until it does.
