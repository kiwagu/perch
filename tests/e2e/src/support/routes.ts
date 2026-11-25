/**
 * The address a test expects a page at, by a route of the contract (`CONTRACT_ROUTES`): the URL
 * ends with the route's path, then with what the pattern `rest` allows after it (nothing, by
 * default; `(\?.*)?$` lets a search follow).
 */
export const atRoute = (route: string, rest = '$'): RegExp =>
  new RegExp(`${route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${rest}`)
