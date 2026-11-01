/**
 * An organisation: a group of identities that share a tenant region. It is known by a key,
 * which names its database and region, and shows a name; the identity that creates one is
 * its administrator.
 */

/** The longest organisation name, in characters; the gateway holds the same bound. */
export const ORGANISATION_NAME_MAX = 80
