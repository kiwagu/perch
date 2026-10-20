# Open the app in a browser that blocks site data

Role: visitor
Where: "/sign-in" in a browser that refuses the page its localStorage

## Test data

## Scenario: A browser that keeps no site data is told so instead of being sent to sign-in again and again

### Steps
1. Make the browser refuse the page its localStorage, as when site data is blocked
2. Open "/sign-in"

### Expected result
- After step 2 the page says "This browser does not let Perch keep data on this device. Allow site data for this site, then reload the page."
- The page shows no sign-in form
