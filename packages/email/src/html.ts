import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from 'parse5'

type Node = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document

type Element = DefaultTreeAdapterTypes.Element

/** An anchor of a document: where it leads and the text it shows. */
export interface Anchor {
  readonly href: string
  readonly text: string
}

/** Every element under `node`, in document order. */
function descendants(node: Node): Element[] {
  const children = 'childNodes' in node ? node.childNodes : []

  return children.flatMap((child) =>
    defaultTreeAdapter.isElementNode(child) ? [child, ...descendants(child)] : [],
  )
}

/** The elements named `tag` that an HTML parser (parse5, as browsers parse) builds from `html`. */
export function elementsNamed(html: string, tag: string): Element[] {
  return descendants(parse(html)).filter((element) => element.tagName === tag)
}

/** The text a node holds, its descendants' included, with every entity decoded. */
export function textOf(node: Node): string {
  if (defaultTreeAdapter.isTextNode(node)) {
    return node.value
  }

  return 'childNodes' in node ? node.childNodes.map(textOf).join('') : ''
}

/** The anchors of `html` that carry an href, in order, with their hrefs as a parser decodes them. */
export function anchorsOf(html: string): Anchor[] {
  return elementsNamed(html, 'a').flatMap((anchor) => {
    const href = defaultTreeAdapter.getAttrList(anchor).find(({ name }) => name === 'href')

    return href === undefined ? [] : [{ href: href.value, text: textOf(anchor) }]
  })
}
