---
tags:
  - full
devices:
  A: guest
  B: identity
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# Reset the password of an account not verified yet

Where: [/forgot-password] and [/reset-password] on device A after a sign-up whose verification mail was not opened, then [/sign-in] on device B, another browser

## Scenario: The reset link proves the mailbox: the email is verified by it, the first sign-in anywhere makes the account's profile and settings from the sign-up, and the sign-up link no longer signs in

### Steps
1. On device A, open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
2. On device A, open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]
3. On device A, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
4. On device B, open [/sign-in], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]
5. On device B, click [app-shell.nav.settings-link]
6. On device A, open the link of [mail:sign-up]

### Expected result
- After step 2 [user.forgot-password.message] carries [code:check-your-mail], and [mail:request-password-reset] reaches the email
- After step 3 [user.reset-password.message] carries [code:password-reset]
- After step 4 [app-shell.notice-message] carries [code:welcome] on device B, its URL is [/me], [user.profile.email-input] holds the email and [user.profile.name-input] holds the name
- After step 5 [user.settings.locale-select] shows [value:en] on device B
- After step 6 [user.verify-email.message] carries [code:verified-before] on device A, its URL stays [/verify-email] and [user.verify-email.sign-in-link] shows
