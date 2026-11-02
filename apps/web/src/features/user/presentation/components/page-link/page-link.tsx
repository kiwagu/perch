import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/** A page's link to a route: a view takes the router's in the app and draws a plain one alone. */
export interface PageLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

/** A plain link, which a view draws when it is given none: its tests run without a router. */
export const PlainLink = ({ to, ...props }: PageLinkProps) => <a href={to} {...props} />

/** The router's link, which a container gives its view. */
export const RouterLink = ({ to, ...props }: PageLinkProps) => <Link to={to} {...props} />
