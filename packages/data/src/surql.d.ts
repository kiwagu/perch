// A plain `.surql` file imported through the surql plugin is its SurrealQL text.
declare module '*.surql' {
  const text: string

  export default text
}
