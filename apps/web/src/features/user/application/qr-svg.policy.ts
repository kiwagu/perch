/**
 * The library that draws a QR code, loaded when a key is first drawn and never with the first
 * frame: it is code run only after the person's own action on a control (turning the second
 * factor on), loaded at that action. The browser loads it once, however often it is asked.
 */
const loadQrLibrary = () => import('uqr')

/**
 * The QR code of `text` as an SVG: a white square with the black modules on it and the four
 * modules of white around them the scanners expect, whatever the page's theme. The picture holds
 * the modules only, none of the text it encodes. A library that cannot be loaded rejects, which
 * fails the start of the second factor that asked for the picture.
 */
export async function qrSvg(text: string): Promise<string> {
  const { renderSVG } = await loadQrLibrary()

  return renderSVG(text, { border: 4 })
}
