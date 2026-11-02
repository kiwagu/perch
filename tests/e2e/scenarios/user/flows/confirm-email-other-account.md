---
tags:
  - full
devices:
  A: identity
  B: identity
data:
  Email: generate
  Password: generate
  Name: generate
  New email: generate
  Other email: generate
  Other password: generate
  Other name: generate
---
# Open an email confirmation link in a browser signed in to another account

Where: [/confirm-email] from [mail:change-email] on device B, where another account is signed in

## Scenario: The link changes the email whichever account this browser holds; with another account signed in, the page offers no link that would not work

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up], open [/settings], enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]
2. On device B, sign up with the other email, the other password and the other name, open the link of [mail:sign-up] and wait for [/me]
3. On device B, open the link of [mail:change-email]

### Expected result
- After step 3 [user.confirm-email.message] carries [code:email-changed] on device B, and neither [user.confirm-email.sign-in-link] nor [user.confirm-email.profile-link] shows
- [user.profile.email-input] on device A holds the new email
