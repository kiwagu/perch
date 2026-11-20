/**
 * How a route module names the paths it serves and reads a request's path against them. A path
 * template is segments joined by `/`: a segment written `:name` is one whole segment, never empty
 * and never holding a `/`, whose text is the parameter `name`; any other segment stands for
 * itself. A module lists its templates once and answers a path only through them, so the paths it
 * lists are the paths it serves.
 */

/** The names of the parameters a path template writes. */
type ParamNames<Template extends string> = Template extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<Rest>
  : Template extends `${string}:${infer Name}`
    ? Name
    : never

/** The parameters of a path that matched a template, each the text of its segment. */
export type PathParams<Template extends string> = {
  readonly [Name in ParamNames<Template>]: string
}

/** The rule each named parameter's text must keep, for the parameters that have one. */
export type PathRules<Template extends string> = {
  readonly [Name in ParamNames<Template>]?: RegExp
}

/**
 * The parameters of `pathname` read against `template`, or `undefined` for a path that is not the
 * template's: a segment more or fewer, another literal segment, an empty parameter, or a
 * parameter whose text breaks its rule in `rules`.
 */
export function matchPath<const Template extends string>(
  template: Template,
  pathname: string,
  rules: PathRules<Template> = {},
): PathParams<Template> | undefined {
  const wanted = template.split('/')
  const given = pathname.split('/')

  if (wanted.length !== given.length) {
    return undefined
  }

  const params: Record<string, string> = {}

  for (const [index, segment] of wanted.entries()) {
    const text = given[index]

    if (text === undefined) {
      return undefined
    }

    if (!segment.startsWith(':')) {
      if (segment !== text) {
        return undefined
      }

      continue
    }

    const name = segment.slice(1)
    const rule: RegExp | undefined = (rules as Readonly<Record<string, RegExp | undefined>>)[name]

    if (text === '' || (rule !== undefined && !rule.test(text))) {
      return undefined
    }

    params[name] = text
  }

  return params as PathParams<Template>
}
