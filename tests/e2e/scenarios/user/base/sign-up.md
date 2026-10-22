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
# Sign up and see the profile

Where: [/sign-in] then [user.sign-in.toggle-button]

## Scenario: A new user signs up and lands on the profile page

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Click [user.sign-in.toggle-button]
3. Enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]
4. Click [user.sign-in.submit-button]

### Expected result
- After step 4 [app-shell.notice-message] carries [code:welcome], the URL is [/me] and [user.profile.heading] shows the entered name
- [user.profile.email-input] shows the entered email
- Reloading the page keeps the user signed in and shows the same name
