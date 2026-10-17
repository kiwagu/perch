# Sync from one tab per browser

Role: user
Where: "/me" in two tabs of device A, and "/me" on device B, another browser

## Test data
- New name: generate

## Scenario: Two tabs of one browser share one sync leader, and the other tab takes over when the leader closes

### Steps
1. On device A, open "/me" in a first tab and wait for the app to be ready
2. On device A, open "/me" in a second tab and wait for the app to be ready
3. On device B, sign in with the same account and wait for "/me"
4. In the tab of device A that does not lead the sync, enter the new name and click "Save"
5. Close the tab of device A that leads the sync

### Expected result
- After step 2 exactly one of the two tabs of device A leads the sync, and only that tab holds a sync channel
- Within 5 seconds of step 4 device B shows the new name
- Within 2 seconds of step 5 the remaining tab of device A leads the sync, and its sync channel then comes up
