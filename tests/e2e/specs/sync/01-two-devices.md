# Keep one account in step on two devices

Role: user
Where: "/me" on device A, and "/me" on device B, another browser

## Test data
- Bio: generate
- New name: generate

## Scenario: A bio written on one device and a name changed on another reach both devices

### Steps
1. On device A, open "/me" and wait for the app to be ready
2. On device A, enter the bio and click "Save"
3. On device B, sign in with the same account and wait for "/me"
4. On device B, enter the new name and click "Save"

### Expected result
- After step 2 device A shows the notification "Saved"
- After step 3 device B shows the bio entered on device A
- Within 5 seconds of step 4 device A shows the new name in the heading, without a reload
- The time from the click on device B to the new name on device A is reported as "sync-latency-ms"
