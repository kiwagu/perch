---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  Other email: generate
  Unknown email: generate
---
# Ask for a new verification link for any email

Where: [/verify-email] with a token no mail carried, then [user.verify-email.resend-button] for an email waiting for its link, an unknown email and a verified one

## Scenario: A resend for an unknown email, or for one verified already, answers as a resend for an email waiting for its link does, and sends no mail

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Click [user.sign-in.toggle-button], enter the other email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
3. Open [/verify-email] with a made-up token
4. Enter the other email into [user.verify-email.email-input] and click [user.verify-email.resend-button]
5. Enter the unknown email into [user.verify-email.email-input] and click [user.verify-email.resend-button]
6. Enter the email into [user.verify-email.email-input] and click [user.verify-email.resend-button]

### Expected result
- After step 3 [user.verify-email.error] carries [code:link-invalid]
- After step 4 [user.verify-email.message] carries [code:check-your-mail], no [user.verify-email.error] shows, and [mail:resend-verification] reaches the other email
- After step 5 and after step 6 the page shows what it showed after step 4: [user.verify-email.message] carries [code:check-your-mail], no [user.verify-email.error] shows, and the URL stays [/verify-email]
- No [mail:resend-verification] reaches the unknown email or the email
