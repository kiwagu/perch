---
tags:
  - full
devices:
  A: operator
  B: identity
  C: identity
data:
  Operator email: generate
  Operator name: generate
  Email: generate
  Password: generate
  Name: generate
  Other email: generate
  Other name: generate
  Organisation key: generate
  Organisation name: generate
---
# Remove an account

Where: [/console/account] on device A, an operator; [/org] on device B, the account's own browser; [/org] on device C, another member's browser

## Scenario: The removal of an organisation's only administrator is refused while other members are in, the operator's own account is refused, and the removal then goes through with its notice

### Steps
1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page
2. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up], open [/org], enter the organisation key and the organisation name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device C, sign up with the other email, the password and the other name, open the link of [mail:sign-up] and wait for [/me]
4. On device B, invite the other email with [organisation.invite.email-input] and [organisation.invite.submit-button]
5. On device C, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]
6. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
7. On device A, click [console.account.removal.remove-button] and confirm with [app-shell.confirmation.confirm-button]
8. On device A, open [/console/users], enter the operator email into [console.users.search-input], click [console.users.search-button], click [console.users.list.open-link] on its own [console.users.list.account-item], click [console.account.removal.remove-button] and confirm with [app-shell.confirmation.confirm-button]
9. On device B, reload [/org], click [organisation.members.remove-button] on the other account's [organisation.members.item] and confirm with [app-shell.confirmation.confirm-button]
10. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button], click [console.users.list.open-link] on the account's [console.users.list.account-item], click [console.account.removal.remove-button] and confirm with [app-shell.confirmation.confirm-button]

### Expected result
- After step 6 [console.account.organisations.list] on device A holds one [console.account.organisations.item] whose [console.account.organisations.name-cell] shows the organisation name and whose [console.account.organisations.role-badge] carries [value:admin]
- After step 7 [console.account.removal.error] carries [code:last-admin] on device A, the card stays, and device B stays on [/org]
- After step 8 [console.account.removal.error] carries [code:own-account] on device A, whose card shows [console.account.operator-badge], and device A stays signed in
- After step 10 [app-shell.toast] carries [code:account-removed] on device A, whose URL is [/console/users], and [console.users.list] no longer holds the account's [console.users.list.account-item]; within 5 seconds device B is on [/sign-in] and its browser keeps no local database of the account; [notice:accounts.remove.account-deleted] reaches the email; on device C, [/org] shows no membership of the organisation, which went with the account
