---
tags:
  - full
devices:
  A: admin
  B: member
data:
  Organisation key: generate
  Organisation name: generate
  Invited email: generate
  Password: generate
  Name: generate
---
# Invite an email that has no account yet

Where: [/org] on device A (user A, administrator, in Spanish) and [/sign-in], then [/org], on device B (another browser)

## Scenario: An invitation to an email with no account is mailed in the inviter's language and waits; the account later made with that email finds it on the organisation page and joins

### Steps
1. On device A, open [/sign-in], choose [value:es] in [app-shell.locale-select], sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
2. On device A, enter the invited email into [organisation.invite.email-input] and click [organisation.invite.submit-button]
3. On device B, sign up with the invited email, the password and the name, open the link of [mail:sign-up] and open [/org]
4. On device B, click [organisation.received.accept-button] on the organisation's [organisation.received.item]
5. On device A, reload [/org]

### Expected result
- After step 2 [app-shell.toast] carries [code:invited] on device A, [organisation.invite.email-input] is empty, [organisation.invite.role-select] shows [value:member], and [organisation.sent.list] holds one [organisation.sent.item], whose [organisation.sent.email-cell] shows the invited email and whose [organisation.sent.role-badge] carries [value:member]
- After step 2 [mail:organisations.invite] reaches the invited email in the language [value:es], user A's, as no account has that email yet
- After step 3 device B shows [organisation.page.status] in [state:empty] and [organisation.received.list] with one [organisation.received.item], whose [organisation.received.name-cell] shows the organisation name and whose [organisation.received.role-badge] carries [value:member]
- After step 4 [app-shell.toast] carries [code:invitation-accepted] on device B, [organisation.page.heading] shows the organisation name, [organisation.page.role-badge] carries [value:member], and no [organisation.received.list] shows
- After step 5 device A shows user B's [organisation.members.item] in [organisation.members.list] and no [organisation.sent.list]
