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
  New email: generate
---
# Change the email of an account that never signed in

Where: [/console/account] on device A, an operator; device B, the browser of an account that signed up and has not opened its link

## Scenario: An operator's email change confirmed from the new mailbox verifies the new email, and the account's first sign-in with it starts the account

### Steps
1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page
2. On device B, sign up with the email, the password and the name, without opening the link
3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]
4. On device A, enter the new email into [console.account.email.email-input] and click [console.account.email.send-button]
5. On device B, open the link of [mail:accounts.change-email]
6. On device B, click [user.confirm-email.sign-in-link], enter the new email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
7. On device A, reload the page

### Expected result
- After step 3 neither [console.account.verified-badge] nor [console.account.name.form] shows on device A: the email is not verified and the account has no profile yet
- After step 5 [user.confirm-email.message] carries [code:email-changed] on device B, beside [user.confirm-email.sign-in-link], and [notice:confirm-email.email-changed] reaches the email
- After step 6 device B is on [/me], [app-shell.notice-message] carries [code:welcome] and [user.profile.heading] shows the name: the first sign-in created the account's profile with the name it signed up with
- After step 7 [console.account.email-cell] on device A shows the new email, and both [console.account.verified-badge] and [console.account.name.form] show
