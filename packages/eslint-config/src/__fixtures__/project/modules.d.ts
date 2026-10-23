// Typed stand-ins for the packages the fixtures import, which are not installed
// here: a fixture is then typed like real workspace code and fires only the rule
// it demonstrates, not the rules against untyped values.

declare module 'surrealdb' {
  export class Surreal {
    readonly connected: boolean
  }
}

declare module '@workspace/data' {
  export interface ShapeRunnerPort {
    readonly id: string
  }

  export class ShapeRunner {
    readonly id: string
  }
}

declare module 'react/jsx-runtime' {
  export namespace JSX {
    interface Element {
      readonly rendered: true
    }

    interface IntrinsicElements {
      readonly [name: string]: Readonly<Record<string, unknown>>
    }
  }

  export function jsx(type: unknown, props: unknown, key?: string): JSX.Element
  export function jsxs(type: unknown, props: unknown, key?: string): JSX.Element
  export const Fragment: unique symbol
}

declare module '*.surql' {
  const text: string
  export default text
}
