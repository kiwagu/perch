# One account per browser

Role: user
Where: "/sign-in" in two tabs of device A

## Test data

## Scenario: A tab left on the sign-in page follows the account another tab signs in, so the browser holds one account

### Steps
1. On device A, open "/me" and wait for the app to be ready
2. Click "Sign out" and wait for "/sign-in"
3. On device A, open "/sign-in" in a second tab and wait for the app to be ready
4. In the first tab, sign in again with the same account and wait for "/me"

### Expected result
- Within 5 seconds of step 4 the second tab is on "/me" and shows the account's name
- After step 4 the browser keeps exactly one local database of an account
