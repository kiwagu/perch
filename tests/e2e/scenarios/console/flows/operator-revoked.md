---
tags:
  - full
devices:
  A: operator
  B: identity
data:
  Operator email: generate
  Operator name: generate
  Email: generate
  Password: generate
  Name: generate
---
# Take the operator role away while the console is open

Where: [/console/account] on device A, an operator whose role is taken away meanwhile; [/me] on device B, another account's browser

## Scenario: The open console of an operator whose role was taken away turns into the not-found page at its next action, and the console link leaves the navigation

### Steps
1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page
2. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
4. Take the operator role away from device A's account by the host's command, as an operator is appointed
5. On device A, click [console.account.sessions.revoke-button] and confirm with [app-shell.confirmation.confirm-button]
6. On device A, reload the page

### Expected result
- After step 3 [console.account.section] is in [state:ready] on device A, and [app-shell.nav] shows [app-shell.nav.console-link]
- After step 5 the address is still [/console/account] with its search on device A, [not-found.page.heading] shows in place of the card, no [console.account.section] shows, [app-shell.nav] shows no [app-shell.nav.console-link], and device B stays on [/me], signed in
- After step 6 [not-found.page.heading] still shows on device A at the same address
