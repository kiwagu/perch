/**
 * Test doubles for code that uses the replica: a clock that moves only when a test says so,
 * a gateway without a network for the sync engine, and the browser's Web Locks and
 * BroadcastChannel as the leader and the hints between tabs use them.
 */

export { FakeHintChannel } from './fake-hint-channel'
export { FakeLocks } from './fake-locks'
export {
  type CompactionAnswer,
  type GatewayStub,
  type GatewayStubOptions,
  gatewayStub,
  type StubTransport,
} from './gateway-stub'
export { type ManualClock, manualClock } from './manual-clock'
