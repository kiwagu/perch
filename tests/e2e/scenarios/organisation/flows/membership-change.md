---
tags:
  - full
devices:
  A: admin
  B: identity
  C: identity
data:
  Organisation key: generate
  Organisation name: generate
  Note by A: generate
---
# Deliver an accepted invitation and a removal to a signed-in device

Where: [/org] on device A (user A, administrator), [/org] on device B (user B, another browser) and [/invitation] from [mail:organisations.invite] on device C (user B again, a third browser)

## Scenario: Device B gains the organisation when its account accepts the invitation elsewhere and loses it when removed, without a reload

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and open [/org]
2. On device A, sign up as user A, open the link of its [mail:sign-up], create the organisation with [organisation.create.submit-button] and add the note by A with [organisation.notes.add-button]
3. On device A, invite user B with [organisation.invite.email-input] and [organisation.invite.submit-button]
4. On device C, sign in as user B with [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.submit-button], open the link of [mail:organisations.invite] and click [organisation.invitation.accept-button]
5. On device A, reload [/org], click [organisation.members.remove-button] on user B's [organisation.members.item] and confirm with [app-shell.confirmation.confirm-button]

### Expected result
- After step 1 device B shows [organisation.page.status] in [state:empty] (not a member of any organisation yet)
- Within 5 seconds of step 4 device B shows the organisation in [organisation.page.heading] and the note by A in [organisation.notes.list], without a reload; the delay is reported as "membership-change-ms"
- Within 5 seconds of step 5 device B shows [organisation.page.status] in [state:empty] (not a member of any organisation yet) again, without a reload, and its organisation data is gone from the device: a reload of [/org] still shows no organisation
- Device A shows [organisation.members.list] without user B
