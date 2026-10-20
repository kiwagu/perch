# Sign out while another tab holds the data open

Role: user
Where: "/me" → "Sign out" in a first tab of device A, while a second tab of the same browser holds the account's local database open

## Test data
- none

## Scenario: A sign-out ends even though another tab holds the data open, says so, and the data goes once that tab closes

### Steps
1. On device A, open "/me" in a first tab and wait for the app to be ready
2. On device A, open a second tab that holds the account's local database open and never lets it go, as a frozen tab would
3. In the first tab, click "Sign out"
4. Close the second tab

### Expected result
- Within 15 seconds of step 3 the first tab is on "/sign-in" and says "You are signed out. Your data leaves this device once the other Perch tabs are closed."
- After step 3 the browser still keeps the account's local database
- Within 10 seconds of step 4 the browser keeps no local database of the account
