/**
 * Test doubles for code that uses the replica: a clock that moves only when a test says so,
 * and a gateway without a network for the sync engine.
 */

export {
  type CompactionAnswer,
  type GatewayStub,
  type GatewayStubOptions,
  gatewayStub,
  type StubTransport,
} from './gateway-stub'
export { type ManualClock, manualClock } from './manual-clock'
