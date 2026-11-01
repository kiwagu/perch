---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Open a verification link that does not work

Where: [/verify-email] with a token no mail carried, then [user.verify-email.resend-button]

## Scenario: A broken link says so and sends a new one, whose link signs in

### Steps
1. Open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
2. Open [/verify-email] with a made-up token
3. Enter the email into [user.verify-email.email-input] and click [user.verify-email.resend-button]
4. Open the link of [mail:resend-verification]

### Expected result
- After step 2 [user.verify-email.error] carries [code:link-invalid], with [user.verify-email.email-input] and [user.verify-email.resend-button]
- After step 3 [user.verify-email.message] carries [code:check-your-mail] and [mail:resend-verification] reaches the email
- After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
