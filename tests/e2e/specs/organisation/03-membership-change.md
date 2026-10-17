# Deliver an invitation and a removal to a signed-in device

Role: user
Where: "/org" on device A (user A, administrator) and "/org" on device B (user B, another browser)

## Test data
- Organisation key: generate
- Organisation name: generate
- Note by A: generate

## Scenario: Device B gains the organisation when invited and loses it when removed, without a reload

### Steps
1. On device B, sign up as user B and open "/org"
2. On device A, sign up as user A, create the organisation and add the note by A
3. On device A, invite user B
4. On device A, click "Remove" next to user B

### Expected result
- After step 1 device B shows "You are not a member of any organisation yet."
- Within 5 seconds of step 3 device B shows the organisation and the note by A, without a reload; the delay is reported as "membership-change-ms"
- Within 5 seconds of step 4 device B shows "You are not a member of any organisation yet." again, without a reload, and its organisation data is gone from the device: a reload of "/org" still shows no organisation
- Device A shows the members list without user B
