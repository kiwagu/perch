# Sign out of one device

Role: user
Where: "/me" → "Sign out" on device A, and "/me" on device B, another browser

## Test data
- Bio: generate
- New name: generate
- Unsent name: generate

## Scenario: Signing out deletes the device's data and leaves the other device signed in, and asks first while changes are unsent

### Steps
1. On device A, open "/me", enter the bio and click "Save"
2. On device B, sign in with the same account and wait for "/me"
3. On device A, click "Sign out"
4. On device B, enter the new name and click "Save"
5. On device A, sign in again with the same account and wait for "/me"
6. Take device A offline, enter the unsent name and click "Save"
7. On device A, click "Sign out"
8. Click "Stay signed in"

### Expected result
- After step 3 device A is on "/sign-in" and its browser keeps no local database of the account
- After step 4 device B, still signed in, shows the notification "Saved"
- After step 5 device A shows the profile the server holds: the new name from device B and the bio from step 1
- After step 7 device A asks before deleting the change it could not send
- After step 8 device A stays on "/me" with the unsent name, and its local database is kept
