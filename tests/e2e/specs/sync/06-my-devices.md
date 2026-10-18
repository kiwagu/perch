# Sign a device out from another one, and everywhere

Role: user
Where: "/devices" on device A, and "/me" on device B, another browser

## Test data
- Email: generate
- Password: generate
- Name: generate

## Scenario: A device signed out from another one leaves at once, signing out everywhere signs every device out, and the account signs in again after it

### Steps
1. On device A, sign up and open "/devices"
2. On device B, sign in with the same account and wait for "/me"
3. On device A, reload "/devices"
4. On device A, click "Sign out" next to device B
5. On device B, sign in again with the same account and wait for "/me"
6. On device A, click "Sign out everywhere" and confirm with "Sign out everywhere"
7. On device A, sign in again with the same account and wait for "/me"

### Expected result
- After step 1 device A lists one device, marked "This device"
- After step 3 device A lists two devices: device B is not marked "This device" and was last seen within the last minute
- Within 5 seconds of step 4 device B is on "/sign-in" with "You were signed out from another device.", and its browser keeps no local database of the account; device A lists device B as signed out
- After step 6 device A is on "/sign-in" with "You were signed out from another device."; within 5 seconds device B is on "/sign-in" with the same notice; a reload of either stays on "/sign-in"
- After step 7 device A is on "/me" and its sync channel is up: the account signs in again after signing out everywhere
