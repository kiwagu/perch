/**
 * The platform operators' console: the accounts of the platform as operators read them, their
 * bans, the names operators give their profiles, and the routes.
 */

export {
  AccountBans,
  type AccountBansOptions,
  type BanOutcome,
  type UnbanOutcome,
} from './account-bans'
export {
  type AccountCard,
  AccountDirectory,
  type AccountOrganisation,
  type AccountPage,
  type AccountSearch,
  type ListedAccount,
} from './account-directory'
export { type ConsoleRoutesOptions, consoleRoutes } from './console-routes'
export { ProfileNames, type ProfileNamesOptions, type Renaming } from './profile-names'
