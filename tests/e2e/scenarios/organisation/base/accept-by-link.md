---
tags:
  - full
devices:
  A: admin
  B: member
data:
  Organisation key: generate
  Organisation name: generate
---
# Accept an invitation by the link of its mail

Where: [/org] on device A (user A, administrator) and [/invitation] from [mail:organisations.invite] on device B (user B, in Spanish, another browser)

## Scenario: The invitation mail speaks the invited account's language; its link shows the organisation and the role and, accepted, opens the organisation; the same link then no longer works

### Steps
1. On device B, open [/sign-in], choose [value:es] in [app-shell.locale-select], sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device B, open the link of [mail:organisations.invite]
5. On device B, click [organisation.invitation.accept-button]
6. On device B, open the link of [mail:organisations.invite] again

### Expected result
- After step 3 [mail:organisations.invite] reaches user B's email in the language [value:es], user B's and not user A's
- After step 4 the link opens [/invitation], [organisation.invitation.heading] shows the organisation name, [organisation.invitation.role-badge] carries [value:member], and [organisation.invitation.accept-button] and [organisation.invitation.decline-button] show; the page shows no email
- After step 5 the URL is [/org], [app-shell.toast] carries [code:invitation-accepted], [organisation.page.heading] shows the organisation name and [organisation.page.role-badge] carries [value:member]
- After step 6 [organisation.invitation.error] carries [code:link-invalid], and neither [organisation.invitation.accept-button] nor [organisation.invitation.decline-button] shows
