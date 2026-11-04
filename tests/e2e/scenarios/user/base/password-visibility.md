---
tags:
  - smoke
devices:
  A: guest
data:
  Password: generate
---
# Show the password as it is typed

Where: [/sign-in], the eye of [user.sign-in.password-input]

## Scenario: The eye beside a password shows what was typed and hides it again

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Enter the password into [user.sign-in.password-input]
3. Click [user.sign-in.password-input.visibility-button]
4. Click [user.sign-in.password-input.visibility-button]

### Expected result
- After step 2 [user.sign-in.password-input.visibility-button] carries [value:show] and [user.sign-in.password-input] hides what it holds
- After step 3 [user.sign-in.password-input.visibility-button] carries [value:hide] and [user.sign-in.password-input] shows the password as typed
- After step 4 [user.sign-in.password-input.visibility-button] carries [value:show] again
