/**
 * The client address each Playwright worker's browsers claim at the e2e stand's front, which
 * passes it on to the gateway as the request's address (`PERCH_CLIENT_ADDRESS=claimed`,
 * `infra/dev/Caddyfile`). Every browser of the suite reaches the front from 127.0.0.1, and the
 * gateway counts its request limits per client address, so without a claim the whole run would
 * spend one address's limits at once; with it, each worker spends its own, as one client running
 * its tests one after another would. The addresses come from 198.18.0.0/15, a range set aside
 * for benchmarks, as the simulated devices of the gateway's smoke test do.
 */

/** The request header a browser claims its client address in; only the e2e front reads it. */
export const CLIENT_ADDRESS_HEADER = 'X-Perch-Client-Address'

/** The address the browsers of the worker in slot `parallelIndex` claim. */
export const clientAddressOf = (parallelIndex: number): string => `198.18.0.${parallelIndex + 1}`
