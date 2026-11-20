/**
 * The border color of a field, by its state, on the element that already draws the field's
 * border: only `border-color` changes, so the field keeps its size, spacing and focus halo. The
 * selectors exclude each other, which gives the precedence: invalid (the field's own
 * `aria-invalid` color) over `unsaved` (the `warning` token) over `saved` (the `success` token)
 * over focus over the default. A field that marks no state keeps the plain focus color.
 */
export const stateBorder = (marks: boolean): string =>
  marks
    ? 'data-[state=unsaved]:not-aria-invalid:border-warning data-[state=saved]:not-aria-invalid:border-success focus-visible:not-data-[state]:not-aria-invalid:border-ring'
    : 'focus-visible:border-ring'
