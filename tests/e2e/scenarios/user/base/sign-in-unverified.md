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
# Sign in before the email is verified

Where: [/sign-in] after a sign-up whose verification mail was not opened

## Scenario: An account whose email is not verified cannot sign in; the page sends the mail again, and its link signs in

### Steps
1. Open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
2. Reload the page, enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
3. Click [user.sign-in.resend-button]
4. Open the link of [mail:resend-verification]

### Expected result
- After step 2 [user.sign-in.error] carries [code:email-not-verified], [user.sign-in.resend-button] shows and the URL stays [/sign-in]
- After step 3 [user.sign-in.mail-message] carries [code:check-your-mail], the error of step 2 is gone (no [user.sign-in.error] shows), and [mail:resend-verification] reaches the email
- After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
