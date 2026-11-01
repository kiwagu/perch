/** The request's JSON body, or `undefined` when it is not JSON. */
export async function readBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown
  } catch {
    // A body that is not JSON fails the schema like any other wrong body.
    return undefined
  }
}
