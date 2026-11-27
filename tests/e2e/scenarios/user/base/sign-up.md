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
# Sign up, verify the email and see the profile

Where: [screen:user.sign-in] then [user.sign-in.toggle-button], then [screen:user.verify-email] from [mail:sign-up]

## Scenario: A new user signs up, opens the link of the verification mail and lands on the profile page

### Steps
1. Open [screen:user.sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Click [user.sign-in.toggle-button]
3. Enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input]
4. Click [user.sign-in.submit-button]
5. Open the link of [mail:sign-up]

### Expected result
- After step 4 [user.sign-in.mail-message] carries [code:check-your-mail], [user.sign-in.resend-button] shows, no [user.sign-in.password-confirmation-input] or [user.sign-in.name-input] shows, the URL stays [screen:user.sign-in], and [mail:sign-up] reaches the email
- After step 5 the link opens [screen:user.verify-email], then [app-shell.notice-message] carries [code:welcome], the URL is [screen:user.profile] and [user.profile.heading] shows the entered name
- [user.profile.email-input] shows the entered email
- Reloading the page keeps the user signed in and shows the same name
