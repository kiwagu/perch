---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# Set a new password through the mail

Where: [/sign-in] then [user.sign-in.forgot-link], [/forgot-password], then [/reset-password] from [mail:request-password-reset]

## Scenario: A user who forgot the password asks for the mail, sets a new password from its link, and signs in with it while the old one no longer works

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Enter the email into [user.sign-in.email-input] and click [user.sign-in.forgot-link]
3. Click [user.forgot-password.send-button]
4. Open the link of [mail:request-password-reset]
5. Enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
6. Click [user.reset-password.sign-in-link], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]
7. Enter the new password into [user.sign-in.password-input] and click [user.sign-in.submit-button]

### Expected result
- After step 2 the URL is [/forgot-password] and [user.forgot-password.email-input] holds the email
- After step 3 [user.forgot-password.message] carries [code:check-your-mail], and [mail:request-password-reset] reaches the email
- After step 4 the link opens [/reset-password], with [user.reset-password.password-rule-list]
- After step 5 [user.reset-password.message] carries [code:password-reset], [user.reset-password.sign-in-link] shows, and [notice:reset-password.password-changed] reaches the email
- After step 6 [user.sign-in.error] carries [code:invalid-credentials]
- After step 7 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
