---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# Reset the password of an account not verified yet

Where: [/forgot-password] after a sign-up whose verification mail was not opened, then [/reset-password] from [mail:request-password-reset]

## Scenario: The reset link proves the mailbox: the email is verified by it, and the account signs in with the new password, its profile made from the sign-up

### Steps
1. Open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]
3. Open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
4. Click [user.reset-password.sign-in-link], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]

### Expected result
- After step 2 [user.forgot-password.message] carries [code:check-your-mail], and [mail:request-password-reset] reaches the email
- After step 3 [user.reset-password.message] carries [code:password-reset]
- After step 4 [app-shell.notice-message] carries [code:welcome], the URL is [/me], [user.profile.email-input] holds the email and [user.profile.name-input] holds the name
