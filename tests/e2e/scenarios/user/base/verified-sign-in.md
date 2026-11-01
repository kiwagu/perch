---
tags:
  - smoke
activity: session
devices:
  A: identity
data:
  Email: generate
  Password: generate
  Name: generate
---
# Sign in with a verified email and see the profile

Where: [/sign-in] for an account whose email is verified

## Scenario: An account whose email is verified signs in and lands on the profile page

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and wait for [/me]
2. Click [user.profile.sign-out-button] and wait for [/sign-in]
3. Enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]

### Expected result
- After step 3 [app-shell.notice-message] carries [code:welcome], the URL is [/me] and [user.profile.heading] shows the name the account signed up with
- Reloading the page keeps the account signed in and shows the same name
