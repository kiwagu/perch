# Sign out of a device whose data will not open

Role: user
Where: "/me" → "Sign out on this device", once the account's local database is broken

## Test data

## Scenario: A device that cannot open the account's data offers to sign out on it, which leaves nothing of the account behind

### Steps
1. Open "/me" and wait for the app to be ready
2. Leave the app for another page of the same site and break the account's local database, so that the app can no longer open it
3. Open "/me"
4. Click "Sign out on this device"

### Expected result
- After step 3 the page says "This device could not open your data. Reload the page to try again, or sign out on this device: changes it has not sent yet are lost." and offers "Sign out on this device"
- Within 15 seconds of step 4 the page is on "/sign-in" and shows the sign-in form
- Within 15 seconds of step 4 the browser keeps no local database of the account and no longer names the account as signed in
