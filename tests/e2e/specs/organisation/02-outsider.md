# Keep an organisation invisible to accounts outside it

Role: user
Where: "/org" on device A (user A) and "/org" on device C (user C, another browser)

## Test data
- Organisation key: generate
- Organisation name: generate
- Note by A: generate
- Key of C's organisation: generate
- Name of C's organisation: generate

## Scenario: An account that was not invited sees no organisation and no notes

### Steps
1. On device A, sign up as user A, open "/org", create the organisation and add the note by A
2. On device C, sign up as user C and open "/org"
3. On device C, create C's own organisation

### Expected result
- After step 2 device C shows "You are not a member of any organisation yet." and no notes
- After step 3 device C shows C's organisation with no notes, and no selector for another organisation
- Device A still shows only its own organisation and the note by A
