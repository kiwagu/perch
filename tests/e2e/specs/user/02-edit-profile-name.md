# Rename yourself on the profile page

Role: user
Where: "/me" → "Save"

## Test data
- New name: generate

## Scenario: A signed-in user changes their name and keeps it after a reload

### Steps
1. Open "/me" and wait for the app to be ready
2. Clear the name
3. Enter the new name
4. Click "Save"

### Expected result
- After step 4 the page shows the notification "Saved"
- The heading shows the new name
- Reloading the page keeps the new name
