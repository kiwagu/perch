---
tags:
  - full
devices:
  A: identity
data:
  Idle minutes: "10"
  Frames per minute at most: "2"
---
# Stay quiet while idle

Where: [/me] in a visible tab left alone

## Scenario: A visible tab with its sync channel up sends few sync frames while nobody uses it

### Steps
1. Put the page's clock under the test's control, open [/me] and wait until the sync channel is up and the catch-up after opening has settled
2. Leave the tab idle for the idle minutes of the page's time

### Expected result
- The page reports no error, keeps checking in with the gateway, and sends at most the allowed number of sync frames per minute, on average over the idle time
- The measured rate is reported as "idle-frames-per-minute"
