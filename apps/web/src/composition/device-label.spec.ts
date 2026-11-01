import { describe, expect, it } from 'vitest'

import { deviceLabel } from './device-label'

const CHROME_ON_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const SAFARI_ON_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const FIREFOX_ON_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'

const EDGE_ON_MACOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'

describe('deviceLabel', () => {
  it('names Chrome on Linux from the client hints', () => {
    expect(
      deviceLabel({
        userAgentData: {
          platform: 'Linux',
          brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }, { brand: 'Not_A Brand' }],
        },
        userAgent: CHROME_ON_LINUX,
      }),
    ).toBe('Chrome on Linux')
  })

  it('names Chrome on Linux from the user agent alone', () => {
    expect(deviceLabel({ userAgent: CHROME_ON_LINUX })).toBe('Chrome on Linux')
  })

  it('names Safari on iPhone', () => {
    expect(deviceLabel({ userAgent: SAFARI_ON_IPHONE })).toBe('Safari on iPhone')
  })

  it('names Firefox on Windows and Edge on macOS', () => {
    expect(deviceLabel({ userAgent: FIREFOX_ON_WINDOWS })).toBe('Firefox on Windows')
    expect(deviceLabel({ userAgent: EDGE_ON_MACOS })).toBe('Edge on macOS')
  })

  it('names a browser on a device it does not know as Browser on device', () => {
    expect(deviceLabel({ userAgent: 'Bun/1.4.3' })).toBe('Browser on device')
    expect(
      deviceLabel({ userAgentData: { brands: [{ brand: 'Not)A;Brand' }] }, userAgent: '' }),
    ).toBe('Browser on device')
  })

  it('keeps the label within 60 characters', () => {
    const label = deviceLabel({
      userAgentData: { platform: 'P'.repeat(100), brands: [{ brand: 'B'.repeat(100) }] },
      userAgent: '',
    })

    expect(label.length).toBeLessThanOrEqual(60)
    expect(label).toMatch(/^B+ on P+$/)
  })
})
