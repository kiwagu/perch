# Edit offline and catch up when back online

Role: user
Where: "/me" on device A, and "/me" on device B, another browser

## Test data
- Bio: generate
- New name: generate

## Scenario: A bio written offline on one device and a name changed meanwhile on another reach both devices

### Steps
1. On device A, open "/me" and wait for the app to be ready
2. On device B, sign in with the same account and wait for "/me"
3. Take device B offline
4. On device B, enter the bio and click "Save"
5. On device A, enter the new name and click "Save"
6. Bring device B back online

### Expected result
- After step 3 the sync channel of device B is down
- After step 4 device B shows the notification "Saved" and the bio, and its sync channel is still down
- After step 5 device A shows the notification "Saved" and the new name
- After step 6 the sync channel of device B comes up again
- Then both devices show the new name from device A and the bio from device B
