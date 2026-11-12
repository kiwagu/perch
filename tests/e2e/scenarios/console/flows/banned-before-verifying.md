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
# Ban an account before it verified its email

Where: [/console/account] on device A, an operator; device B, the browser of an account that signed up and has not opened its link yet

## Scenario: A banned account's verification link still verifies the email but signs nothing in and says the account is banned, its sign-in is refused as banned, not as unverified, and once the ban is lifted its first sign-in starts it

### Steps
1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page
2. On device B, sign up with the email, the password and the name, without opening the link
3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
4. On device A, click [console.account.ban.ban-button] and confirm with [app-shell.confirmation.confirm-button]
5. On device B, open the link of [mail:sign-up]
6. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
7. On device A, reload the page
8. On device A, click [console.account.ban.unban-button]
9. On device B, click [user.sign-in.submit-button] again
10. On device A, reload the page

### Expected result
- After step 4 [app-shell.toast] carries [code:ban-set] on device A, [console.account.banned-badge] shows and no [console.account.reason-cell] does, since no reason was given; no [console.account.verified-badge] shows
- After step 5 [user.verify-email.error] carries [code:account-banned] on device B, no [user.verify-email.form] shows, and device B is not signed in: its URL stays [/verify-email]
- After step 6 [user.sign-in.error] carries [code:account-banned] on device B, not [code:email-not-verified]
- After step 7 [console.account.verified-badge] shows on device A: the link verified the email; no [console.account.name.form] shows, since the account has no profile yet
- After step 9 device B is on [/me], [app-shell.notice-message] carries [code:welcome] and [user.profile.heading] shows the name: the first sign-in created the account's profile with the name it signed up with
- After step 10 [console.account.name.form] shows on device A
