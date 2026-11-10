---
tags:
  - full
devices:
  A: operator
  B: identity
data:
  Email: generate
  Password: generate
  Name: generate
  New name: generate
  New email: generate
---
# Rename an account and change its email from its card

Where: [/console/users] on device A, an operator; [/me] on device B, the account's own browser

## Scenario: A row opens the account's card, the operator renames the account, which its own device shows, and changes its email, which the new mailbox confirms

### Steps
1. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
3. On device A, reload the page
4. On device A, enter the new name into [console.account.name.name-input] and click [console.account.name.save-button]
5. On device A, enter the new email into [console.account.email.email-input] and click [console.account.email.send-button]
6. On device B, open the link of [mail:accounts.change-email]
7. On device A, reload the page

### Expected result
- After step 2 the URL is [/console/account] with the account's id as its search, [console.account.section] is in [state:ready], [console.account.heading] shows the name, [console.account.email-cell] shows the email, [console.account.verified-badge] shows, and neither [console.account.banned-badge] nor [console.account.operator-badge] does
- After step 3 the card is the same: the address alone names the account
- After step 4 [app-shell.toast] carries [code:name-saved] on device A and [console.account.heading] shows the new name; within 5 seconds [user.profile.heading] on device B shows the new name, without a reload
- After step 5 [app-shell.toast] carries [code:email-change-sent] on device A, [console.account.email.email-input] is empty, [console.account.email-cell] still shows the email, and [mail:accounts.change-email] reaches the new email
- After step 6 [user.confirm-email.message] carries [code:email-changed] on device B, [notice:confirm-email.email-changed] reaches the email, and [user.profile.email-input] on device B holds the new email
- After step 7 [console.account.email-cell] on device A shows the new email, and [console.account.verified-badge] still shows
