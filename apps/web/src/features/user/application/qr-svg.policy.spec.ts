import { describe, expect, it, vi } from 'vitest'

import { qrSvg } from './qr-svg.policy'

const URI = 'otpauth://totp/Perch:ann%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Perch'

describe('qrSvg', () => {
  it('draws the address as an SVG that holds its modules and none of its text', async () => {
    const svg = await qrSvg(URI)

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('viewBox=')
    expect(svg).toContain('<path')
    expect(svg).not.toContain('JBSWY3DPEHPK3PXP')
  })

  it('draws the same picture for the same address and another for another', async () => {
    expect(await qrSvg(URI)).toBe(await qrSvg(URI))
    expect(await qrSvg(URI)).not.toBe(await qrSvg(`${URI}2`))
  })

  it('fails when the library cannot be loaded, leaving it to the caller to say so', async () => {
    vi.resetModules()
    vi.doMock('uqr', () => {
      throw new Error('the chunk did not load')
    })

    const { qrSvg: unloadable } = await import('./qr-svg.policy')

    await expect(unloadable(URI)).rejects.toBeInstanceOf(Error)
    vi.doUnmock('uqr')
  })
})
