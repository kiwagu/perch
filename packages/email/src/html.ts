import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from 'parse5'

import { ACTION_ATTRIBUTE } from './mail.action'

type Node = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document

type Element = DefaultTreeAdapterTypes.Element

/** An anchor of a document: where it leads, the text it shows, and the action it is marked as. */
export interface Anchor {
  /** Its `href` as a parser decodes it, or undefined when it has none. */
  readonly href: string | undefined
  readonly text: string
  /** Its `data-mail-action`, or undefined when it is not marked as an action. */
  readonly action: string | undefined
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

/** The value of an element's attribute `name`, decoded, or undefined when it has none. */
const attributeOf = (element: Element, name: string): string | undefined =>
  defaultTreeAdapter.getAttrList(element).find((attribute) => attribute.name === name)?.value

/** Every anchor of `html`, in order, its href and its action mark as a parser decodes them. */
export function anchorsOf(html: string): Anchor[] {
  return elementsNamed(html, 'a').map((anchor) => ({
    href: attributeOf(anchor, 'href'),
    text: textOf(anchor),
    action: attributeOf(anchor, ACTION_ATTRIBUTE),
  }))
}
