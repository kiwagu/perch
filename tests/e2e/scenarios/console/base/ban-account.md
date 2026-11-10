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
  Reason: generate
---
# Ban an account and lift the ban

Where: [/console/account] on device A, an operator; [/me] on device B, the account's own browser

## Scenario: A ban signs the account's device out and tells it plainly, its sign-in is refused, and once the ban is lifted it signs in again

### Steps
1. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
3. On device A, enter the reason into [console.account.ban.reason-input], click [console.account.ban.ban-button] and confirm with [app-shell.confirmation.confirm-button]
4. On device B, enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
5. On device A, click [console.account.ban.unban-button]
6. On device B, click [user.sign-in.submit-button] again

### Expected result
- After step 3 [app-shell.toast] carries [code:ban-set] on device A, [console.account.banned-badge] shows, [console.account.reason-cell] shows the reason, [console.account.ban.reason-input] is empty, [console.account.ban.unban-button] shows and [console.account.ban.ban-button] does not; within 5 seconds device B is on [/sign-in], where [user.sign-in.notice-message] carries [code:account-banned] and nothing names the reason, and its browser keeps no local database of the account
- After step 4 [user.sign-in.error] carries [code:account-banned] on device B, and the URL stays [/sign-in]
- After step 5 [app-shell.toast] carries [code:ban-lifted] on device A, [console.account.banned-badge] no longer shows, nor does [console.account.reason-cell], and [console.account.ban.ban-button] shows again
- After step 6 device B is on [/me] and [app-shell.notice-message] carries [code:welcome]
