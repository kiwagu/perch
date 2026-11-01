/**
 * The mails' design tokens: the web app's light palette (`packages/ui/src/styles/global.css`,
 * `:root`) mirrored as literal sRGB hex. Mail clients resolve neither CSS custom properties nor
 * `oklch()`, so the values are copied, not imported; the palette is neutral (no chroma), so each
 * hex is exact to the 8-bit channel. Light only: a static mail cannot negotiate a client's dark
 * mode, and a `prefers-color-scheme` block is ignored or mangled by enough clients to be a
 * liability.
 */
export const mailTheme = {
  color: {
    /** `--background`, `--card`: oklch(1 0 0). */
    background: '#ffffff',
    /** `--muted`, `--secondary`: oklch(0.97 0 0), the page behind the card. */
    surface: '#f5f5f5',
    /** `--foreground`: oklch(0.145 0 0). */
    foreground: '#0a0a0a',
    /** `--muted-foreground`: oklch(0.556 0 0). */
    muted: '#737373',
    /** `--border`: oklch(0.922 0 0). */
    border: '#e5e5e5',
    /** `--primary`: oklch(0.205 0 0). */
    button: '#171717',
    /** `--primary-foreground`: oklch(0.985 0 0). */
    buttonForeground: '#fafafa',
  },
  font: {
    /** The web's Inter where the reader has it installed, the system's sans-serif otherwise. */
    body: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  },
  radius: {
    /** `--radius`: 0.625rem. */
    card: '10px',
    /** `--radius-md`: 0.8 × `--radius`. */
    button: '8px',
  },
  size: {
    container: '520px',
  },
} as const
