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
# Open a verification link a second time

Where: [/verify-email] from a [mail:sign-up] whose link was opened already

## Scenario: A link opened again says the email is verified and signs nothing in

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and wait for [/me]
2. Click [user.profile.sign-out-button] and wait for [/sign-in]
3. Open the link of the same [mail:sign-up] again
4. Click [user.verify-email.sign-in-link]

### Expected result
- After step 3 [user.verify-email.message] carries [code:verified-before], the URL stays [/verify-email] and [app-shell.nav.sign-in-link] shows
- After step 4 the URL is [/sign-in]
