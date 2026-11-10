---
tags:
  - full
devices:
  A: operator
  B: identity
  C: guest
data:
  Email: generate
  Password: generate
  New password: generate
  Name: generate
  Other email: generate
  Other name: generate
---
# Sign an account out everywhere and send it its mails

Where: [/console/account] on device A, an operator; [/me] on device B, the account's own browser; device C, another browser, for an account that never signed in

## Scenario: The operator signs the account out everywhere, sends it a password reset the account completes, and sends an unverified account its verification mail again

### Steps
1. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device C, sign up with the other email, the password and the other name, without opening the link
3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
4. On device A, click [console.account.sessions.revoke-button] and confirm with [app-shell.confirmation.confirm-button]
5. On device A, click [console.account.reset.send-button]
6. On device B, open the link of [mail:accounts.send-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input] and click [user.reset-password.submit-button]
7. On device B, open [/sign-in], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
8. On device A, open [/console/users], enter the other email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the other account's [console.users.list.account-item]
9. On device A, click [console.account.verification.resend-button]
10. On device C, open the link of [mail:accounts.resend-verification]

### Expected result
- After step 3 [console.account.seen-cell] shows on device A, since the account's device was seen just now
- After step 4 [app-shell.toast] carries [code:sessions-revoked] on device A and the card stays; within 5 seconds device B is on [/sign-in], where [user.sign-in.notice-message] carries [code:signed-out-elsewhere]
- After step 5 [app-shell.toast] carries [code:reset-sent] on device A, and [mail:accounts.send-reset] reaches the email
- After step 6 [user.reset-password.message] carries [code:password-reset] on device B
- After step 7 device B is on [/me] and [app-shell.notice-message] carries [code:welcome]: the account signs in with the new password
- After step 8 [console.account.heading] shows the other name, no [console.account.verified-badge] shows, [console.account.verification.resend-button] shows and no [console.account.name.form] does, since the account has no profile yet
- After step 9 [app-shell.toast] carries [code:verification-sent] on device A, and [mail:accounts.resend-verification] reaches the other email
- After step 10 device C is on [/me] and [app-shell.notice-message] carries [code:welcome]: the link verified the email and signed the device in
