/**
 * A label a person can read for this browser, such as "Chrome on Linux" or "Safari on iPhone",
 * sent at sign-up and sign-in so that the list of an account's devices tells them apart. It
 * reads the client hints when the browser gives them, the user agent string otherwise; what
 * neither names reads "Browser on device". The gateway takes at most 60 characters.
 */

/** The part of `navigator` the label is read from. */
export interface UserAgentSource {
  readonly userAgentData?: {
    readonly platform?: string
    readonly brands?: ReadonlyArray<{ readonly brand: string }>
  }
  readonly userAgent: string
}

/** How long each half of the label may be: two halves and " on " fit in 60 characters. */
const HALF = 28

/** A brand a browser adds to its client hints so that no site relies on the list's order. */
const GREASE = /not.?a.?brand/i

/** The client-hint brands named otherwise in the label. */
const BRAND_NAMES: ReadonlyMap<string, string> = new Map([
  ['Google Chrome', 'Chrome'],
  ['Microsoft Edge', 'Edge'],
])

/** Browsers in the user agent string, the more specific first: Edge and Opera also say Chrome. */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
]

/** Platforms in the user agent string, the more specific first: an iPhone also says Mac OS X. */
const PLATFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
]

function brandOf(brands: ReadonlyArray<{ readonly brand: string }>): string | undefined {
  const named = brands
    .map(({ brand }) => brand.trim())
    .filter((brand) => brand && !GREASE.test(brand))
  // Every Chromium browser lists Chromium too: the browser's own brand says more.
  const brand = named.find((each) => each !== 'Chromium') ?? named[0]

  return brand === undefined ? undefined : (BRAND_NAMES.get(brand) ?? brand)
}

function firstMatch(
  text: string,
  table: ReadonlyArray<readonly [RegExp, string]>,
): string | undefined {
  return table.find(([pattern]) => pattern.test(text))?.[1]
}

export function deviceLabel(source: UserAgentSource): string {
  const hints = source.userAgentData
  const browser =
    brandOf(hints?.brands ?? []) ?? firstMatch(source.userAgent, BROWSERS) ?? 'Browser'
  const platform = hints?.platform?.trim() || firstMatch(source.userAgent, PLATFORMS) || 'device'

  return `${browser.slice(0, HALF)} on ${platform.slice(0, HALF)}`
}
