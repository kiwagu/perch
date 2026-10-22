---
tags:
  - full
devices:
  A: identity
data:
  Email: generate
  Password: generate
  Name: generate
  Refused access token: refused
---
# Renew the device's keys over its open sync channel

Where: [/devices] in two tabs of one browser

## Scenario: A route that refuses the access token has the tab that leads the sync renew the keys over its open channel, and the route answers with the new ones

### Steps
1. Sign up and wait for [/me] with the sync channel up
2. In the browser's local storage, replace the value of "perch.session.token" with the refused access token
3. Open [/devices]
4. Open [/me] in a second tab of the same browser and wait for [app-shell.status] to reach [state:ready]
5. In the browser's local storage, replace the value of "perch.session.token" with the refused access token again
6. In the second tab, open [/devices]

### Expected result
- After step 1 the first tab leads the sync over one sync socket
- Within 5 seconds of step 3, on [/devices], [device.list] holds one [device.list.session-item], in [state:current] (this device), and the browser keeps a new access token and a new refresh key; the first tab asked for them with one "renew" on its sync socket and got them as "tokens", and opened no other sync socket
- After step 4 the first tab still leads the sync and the second tab holds no sync socket
- Within 5 seconds of step 6 the second tab's [device.list] holds one [device.list.session-item], in [state:current] (this device), and the browser keeps another new pair of keys; the first tab asked for it with a second "renew" on the same sync socket, and neither tab opened another sync socket
