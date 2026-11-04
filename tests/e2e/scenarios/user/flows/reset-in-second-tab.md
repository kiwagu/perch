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
# Set a new password in a second tab while the first waits for the mail

Where: [/forgot-password] in a first tab of device A, then [/reset-password] from [mail:request-password-reset] in a second tab of the same browser

## Scenario: The tab that asked for the mail follows a new password set in another tab: it moves to the sign-in page with the email and says why

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. In a first tab, open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]
3. In a second tab, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
4. In the first tab, enter the new password into [user.sign-in.password-input] and click [user.sign-in.submit-button]

### Expected result
- After step 2 [user.forgot-password.message] carries [code:check-your-mail]
- After step 3 the second tab's [user.reset-password.message] carries [code:password-reset]
- Within 5 seconds of step 3 the first tab is on [/sign-in], [user.sign-in.email-input] holds the email and [user.sign-in.notice-message] carries [code:password-reset-elsewhere]
- After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
