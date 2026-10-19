import { describe, expect, it } from 'vitest'

import { clientAddress } from './client-address'

function requestWith(forwarded?: string): Request {
  return new Request(
    'http://gateway.test/',
    forwarded === undefined ? {} : { headers: { 'X-Forwarded-For': forwarded } },
  )
}

describe('clientAddress', () => {
  it('is the socket peer without a header', () => {
    expect(clientAddress(requestWith(), '127.0.0.1')).toBe('127.0.0.1')
  })

  it('is the rightmost X-Forwarded-For entry', () => {
    expect(clientAddress(requestWith('203.0.113.9, 198.51.100.4'), '127.0.0.1')).toBe(
      '198.51.100.4',
    )
  })

  it('trims spaces', () => {
    expect(clientAddress(requestWith('  203.0.113.9 ,   198.51.100.4  '), '127.0.0.1')).toBe(
      '198.51.100.4',
    )
  })

  it('reads an IPv6 entry', () => {
    expect(clientAddress(requestWith('203.0.113.9, 2001:db8::9'), '127.0.0.1')).toBe('2001:db8::9')
  })

  it('is the peer when the rightmost entry is not an address', () => {
    expect(clientAddress(requestWith('203.0.113.9, not-an-address'), '127.0.0.1')).toBe('127.0.0.1')
    expect(clientAddress(requestWith(''), '127.0.0.1')).toBe('127.0.0.1')
  })

  it('is unknown with neither header nor peer', () => {
    expect(clientAddress(requestWith(), undefined)).toBe('unknown')
    expect(clientAddress(requestWith('nope'), undefined)).toBe('unknown')
  })
})
