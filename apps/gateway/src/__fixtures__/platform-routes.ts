/**
 * Where the gateway serves the platform's actions: the route of each action it serves, the actions
 * the client answers on its own, and the routes of the gateway that no action names, with why.
 */

import type { Wire } from './platform-requests'

/** Where each platform action is served; the actions the client answers on its own are below. */
export const ACTION_ROUTES: Readonly<Record<string, Wire>> = {
  'sign-up': { method: 'POST', path: '/auth/sign-up/email' },
  'sign-in': { method: 'POST', path: '/auth/sign-in/email' },
  'verify-email': { method: 'POST', path: '/auth/verify-email' },
  'resend-verification': { method: 'POST', path: '/auth/send-verification-email' },
  'request-password-reset': { method: 'POST', path: '/auth/request-password-reset' },
  'reset-password': { method: 'POST', path: '/auth/reset-password' },
  'change-password': { method: 'POST', path: '/auth/change-password' },
  'change-email': { method: 'POST', path: '/auth/change-email' },
  'confirm-email': { method: 'POST', path: '/auth/confirm-email' },
  'request-account-deletion': { method: 'POST', path: '/auth/request-account-deletion' },
  'delete-account': { method: 'POST', path: '/auth/delete-account' },
  'sign-out': { method: 'POST', path: '/auth/sign-out' },
  'sign-out-everywhere': { method: 'POST', path: '/auth/sign-out-everywhere' },
  'devices.list': { method: 'GET', path: '/devices' },
  'devices.revoke': { method: 'DELETE', path: '/devices/:id', segments: { id: 'device' } },
  'organisations.create': { method: 'POST', path: '/organisations' },
  'organisations.members': { method: 'GET', path: '/organisations/:key/members' },
  'organisations.invite': { method: 'POST', path: '/organisations/:key/invitations' },
  'organisations.invitations': { method: 'GET', path: '/organisations/:key/invitations' },
  'organisations.revoke-invitation': {
    method: 'DELETE',
    path: '/organisations/:key/invitations/:invitation',
  },
  'organisations.set-role': { method: 'PATCH', path: '/organisations/:key/members/:identity' },
  'organisations.remove': { method: 'DELETE', path: '/organisations/:key/members/:identity' },
  'invitations.read': { method: 'POST', path: '/invitations/read' },
  'invitations.mine': { method: 'GET', path: '/invitations' },
  'invitations.accept': { method: 'POST', path: '/invitations/accept' },
  'invitations.decline': { method: 'POST', path: '/invitations/decline' },
  'accounts.list': { method: 'GET', path: '/console/accounts' },
  'accounts.read': { method: 'GET', path: '/console/accounts/:id' },
  'accounts.rename': { method: 'POST', path: '/console/accounts/:id/rename' },
  'accounts.change-email': { method: 'POST', path: '/console/accounts/:id/email' },
  'accounts.ban': { method: 'POST', path: '/console/accounts/:id/ban' },
  'accounts.unban': { method: 'POST', path: '/console/accounts/:id/unban' },
  'accounts.revoke-sessions': { method: 'POST', path: '/console/accounts/:id/sign-out' },
  'accounts.send-reset': { method: 'POST', path: '/console/accounts/:id/reset' },
  'accounts.resend-verification': { method: 'POST', path: '/console/accounts/:id/verification' },
  'accounts.remove': { method: 'POST', path: '/console/accounts/:id/removal' },
}

/** The actions the client answers on its own: no request of the gateway is made for them. */
export const CLIENT_ONLY: readonly string[] = [
  'theme.set',
  'reload',
  'install.prompt',
  'install.postpone',
  'organisations.select',
  'organisations.copy-invitation',
]

/** The routes the gateway serves that no platform action names, each with its reason. */
export const NO_ACTION_ROUTES: Readonly<Record<string, string>> = {
  'GET /health': 'the liveness answer of the server: no screen asks it',
  'GET /sync': "the upgrade to a device's sync connection, which the sync protocol carries",
  'GET /organisations': 'Contract gap: the memberships read has no platform action',
}

/** The routes the server answers itself, before any module is asked. */
export const SERVER_ROUTES = ['GET /health', 'GET /sync']
