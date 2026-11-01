/**
 * What a member of an organisation may do to the shared records of its region. The rules are
 * data declared next to each table (`-- @owner`, `-- @can` in the schema, emitted by the
 * modeling stage into the replica schema) and this one function reads them: the browser asks
 * it before a command, the gateway before importing a batch. Reading is not an ability:
 * whoever holds the region reads all of it.
 */

export const TENANT_ROLES = ['member', 'admin'] as const

export type TenantRole = (typeof TENANT_ROLES)[number]

export const ACTIONS = ['create', 'update', 'delete'] as const

export type Action = (typeof ACTIONS)[number]

/** Which records of the table a role may act on: any of them, or those it owns. */
export type Scope = 'any' | 'own'

export interface TableAbilities {
  /** The field that names the member a record belongs to, a `record<member>`; an `own` scope reads it. */
  readonly owner?: string
  readonly can?: Readonly<Partial<Record<TenantRole, Readonly<Partial<Record<Action, Scope>>>>>>
}

export type AbilitySchema = Readonly<Record<string, TableAbilities>>

export interface Member {
  /** The identity id, `idn_…`: the key of the member record. */
  readonly id: string
  readonly role: TenantRole
}

export interface Ability {
  /**
   * Whether the member may do `action` to a record of `table`: `record` is the record as it
   * is for an update or a delete, and as it will be for a create.
   */
  can(action: Action, table: string, record?: Readonly<Record<string, unknown>>): boolean
}

/** The key an owner field names: `member:<key>` in a document, `<key>` in a projected row. */
export function ownerKeyOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }

  const colon = value.indexOf(':')

  return colon === -1 ? value : value.slice(colon + 1)
}

export function defineAbilityFor(member: Member, schema: AbilitySchema): Ability {
  return {
    can: (action, table, record) => {
      const rules = schema[table]
      const scope = rules?.can?.[member.role]?.[action]

      if (scope === undefined) {
        return false
      }

      if (scope === 'any') {
        return true
      }

      return rules?.owner !== undefined && ownerKeyOf(record?.[rules.owner]) === member.id
    },
  }
}

/** The one member of a private region, its owner: it does everything to its records. */
export const OWNER_ABILITY: Ability = { can: () => true }

/** Nobody signed in, or no organisation current: nothing is allowed. */
export const NO_ABILITY: Ability = { can: () => false }
