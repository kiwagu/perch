---
tags:
  - full
devices:
  A: admin
  B: member
data:
  Organisation key: generate
  Organisation name: generate
  Note by A: generate
---
# Deliver an invitation and a removal to a signed-in device

Where: [/org] on device A (user A, administrator) and [/org] on device B (user B, another browser)

## Scenario: Device B gains the organisation when invited and loses it when removed, without a reload

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and open [/org]
2. On device A, sign up as user A, open the link of its [mail:sign-up], create the organisation with [organisation.create.submit-button] and add the note by A with [organisation.notes.add-button]
3. On device A, invite user B with [organisation.invite.email-input] and [organisation.invite.submit-button]
4. On device A, click [organisation.members.remove-button] on user B's [organisation.members.item] and confirm with [app-shell.confirmation.confirm-button]

### Expected result
- After step 1 device B shows [organisation.page.status] in [state:empty] (not a member of any organisation yet)
- Within 5 seconds of step 3 device B shows the organisation in [organisation.page.heading] and the note by A in [organisation.notes.list], without a reload; the delay is reported as "membership-change-ms"
- Within 5 seconds of step 4 device B shows [organisation.page.status] in [state:empty] (not a member of any organisation yet) again, without a reload, and its organisation data is gone from the device: a reload of [/org] still shows no organisation
- Device A shows [organisation.members.list] without user B
