# Sign up and see the profile

Role: guest
Where: "/sign-in" → "Create account"

## Test data
- Email: generate
- Password: generate
- Name: generate

## Scenario: A new user signs up and lands on the profile page

### Steps
1. Open "/sign-in" and wait for the app to be ready
2. Click "Create account"
3. Enter email, password and name
4. Click "Sign up"

### Expected result
- After step 4 the page shows the notification "Welcome", the URL is "/me", the heading shows the entered name
- The profile email field shows the entered email
- Reloading the page keeps the user signed in and shows the same name
