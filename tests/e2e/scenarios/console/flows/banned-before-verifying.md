---
tags:
  - full
devices:
  A: operator
  B: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Ban an account before it verified its email

Where: [/console/account] on device A, an operator; device B, the browser of an account that signed up and has not opened its link yet

## Scenario: A banned account's verification link still verifies the email but signs nothing in and says the account is banned, and its sign-in is refused as banned, not as unverified

### Steps
1. On device B, sign up with the email, the password and the name, without opening the link
2. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
3. On device A, click [console.account.ban.ban-button] and confirm with [app-shell.confirmation.confirm-button]
4. On device B, open the link of [mail:sign-up]
5. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
6. On device A, reload the page

### Expected result
- After step 3 [app-shell.toast] carries [code:ban-set] on device A, [console.account.banned-badge] shows and no [console.account.reason-cell] does, since no reason was given; no [console.account.verified-badge] shows
- After step 4 [user.verify-email.error] carries [code:account-banned] on device B, no [user.verify-email.form] shows, and device B is not signed in: its URL stays [/verify-email]
- After step 5 [user.sign-in.error] carries [code:account-banned] on device B, not [code:email-not-verified]
- After step 6 [console.account.verified-badge] shows on device A: the link verified the email
