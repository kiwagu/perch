/** What the parser of the shape dialect answers: the projection, the source and the tail of a shape. */

export type PathStep =
  | { readonly kind: 'field'; readonly name: string }
  | {
      readonly kind: 'edge'
      readonly dir: 'out' | 'in' | 'both'
      readonly edge: string
      readonly target?: string
      readonly inner?: string
    }

export interface PathExpr {
  readonly steps: readonly PathStep[]
}

export interface Projection {
  readonly name: string
  readonly expr: PathExpr
  readonly children?: readonly Projection[]
}

export type ShapeSource =
  | { readonly kind: 'param'; readonly name: string; readonly only: boolean }
  | { readonly kind: 'table'; readonly table: string; readonly only: boolean }

/** A field path in the tail: from the shape's source, or from a record `$parameter`. */
export interface TailPath {
  readonly param?: string
  readonly steps: readonly PathStep[]
  /** A FETCH path also reads the record its last link points to. */
  readonly fetch?: boolean
}

export interface ShapeAst {
  readonly projections: readonly Projection[]
  readonly from: ShapeSource
  readonly tail: string
  readonly tailPaths: readonly TailPath[]
}

/** The arrows of a graph traversal, and the way each one goes. */
export const ARROWS: Readonly<Record<string, 'out' | 'in' | 'both'>> = {
  '->': 'out',
  '<-': 'in',
  '<->': 'both',
}
