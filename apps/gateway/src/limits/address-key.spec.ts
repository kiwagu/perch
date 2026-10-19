import { describe, expect, it } from 'vitest'

import { addressKey } from './address-key'

describe('addressKey', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(addressKey('192.0.2.1')).toBe('192.0.2.1')
  })

  it('reads an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(addressKey('::ffff:192.0.2.1')).toBe('192.0.2.1')
  })

  it('counts the addresses of one /64 under one key', () => {
    expect(addressKey('2001:db8:1:2:3:4:5:6')).toBe(addressKey('2001:db8:1:2::9'))
    expect(addressKey('2001:DB8:0001:2::9')).toBe(addressKey('2001:db8:1:2:3:4:5:6'))
  })

  it('tells two /64 apart', () => {
    expect(addressKey('2001:db8:1:2::9')).not.toBe(addressKey('2001:db8:1:3::9'))
  })

  it('gives the loopback its /64', () => {
    expect(addressKey('::1')).toBe(addressKey('::2'))
    expect(addressKey('::1')).not.toBe('::1')
  })

  it('leaves anything else as it is', () => {
    expect(addressKey('unknown')).toBe('unknown')
  })
})
