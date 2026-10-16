/** An object defined by its identity: two entities are equal when their ids are. */
export abstract class Entity<Id extends string, Props> {
  protected constructor(
    readonly id: Id,
    protected props: Props,
  ) {}

  equals(other: Entity<Id, Props>): boolean {
    return other.id === this.id
  }
}
